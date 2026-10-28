import "server-only";
import { randomUUID } from "node:crypto";
import type { Principal } from "@/types/principal";
import { buildQuery, type StructuredQuery } from "@/lib/validation/odata";
import { logger } from "@/lib/telemetry/logger";
import { metrics } from "@/lib/telemetry/metrics";
import { ResponseCache, ttlFor } from "./cache";
import { allowedBcHost, getConfig, type WmsConfig } from "./config";
import { getCoordinator, type Coordinator } from "./coordinator";
import {
  buildActionUrl,
  buildEntityUrl,
  buildOperationUrl,
  getOperation,
  OPERATION_TYPES,
  type ActionOp,
  type CreateOp,
  type Lane,
  type PatchOp,
  type ReadOp,
} from "./endpoints";
import { classifyStatus, GatewayError } from "./errors";
import { singleton } from "@/lib/singleton";
import { MockBc } from "./mock-bc";
import { decodeODataEnum, encodeODataEnum } from "./odata-enum";
import { RequestScheduler } from "./request-scheduler";
import {
  backoffDelay,
  DEFAULT_READ_BACKOFF,
  parseRetryAfter,
  sleep,
} from "./retry-policy";
import { getTokenManager, type TokenManager } from "./auth";

export interface CallContext {
  principal: Principal;
  correlationId?: string;
}

export interface ReadResult<T> {
  rows: T[];
  meta: {
    source: "hit" | "miss" | "deduped" | "coalesced";
    correlationId: string;
  };
}

export interface WriteResult {
  status: number;
  body: Record<string, unknown>;
  /** True when BC reported the idempotency key already existed and the stored record was returned. */
  duplicate: boolean;
  meta: { correlationId: string };
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface GatewayDeps {
  cfg: WmsConfig;
  coordinator: Coordinator;
  scheduler: RequestScheduler;
  tokens: Pick<TokenManager, "getToken" | "invalidate">;
  transport?: Transport;
  mock?: MockBc;
}

const DUPLICATE_MARKER = "VWMS_DUPLICATE";
const zUuid = (value: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
const MAX_ERROR_BODY = 4096;

/**
 * The single entry point for every Business Central call.
 *  - read:   registry -> permission -> scoped, validated query -> cache -> scheduler -> BC.
 *            Bounded GET-only retries. Rows are projected to the selected fields and enum
 *            values are decoded from OData-escaped names.
 *  - create/patch/invoke: registry -> permission -> scheduler -> exactly ONE attempt.
 *            An ambiguous outcome (timeout, dropped connection, 502/503/504) is surfaced as
 *            OUTCOME_UNKNOWN; the caller reconciles by idempotency key.
 */
export class BcGateway {
  private readonly cache: ResponseCache;
  private readonly transport: Transport;
  private readonly host: string;
  private companyResolution: Promise<void> | undefined;

  constructor(private readonly deps: GatewayDeps) {
    this.cache = new ResponseCache(deps.coordinator);
    this.host = allowedBcHost(deps.cfg);
    if (deps.transport) {
      this.transport = deps.transport;
    } else if (deps.cfg.mode === "mock") {
      const mock = deps.mock ?? new MockBc();
      this.transport = (url, init) =>
        mock.handle(
          String(init.method ?? "GET"),
          new URL(url),
          init.body as string | undefined,
        );
    } else {
      this.transport = (url, init) => fetch(url, init);
    }
  }

  /* ------------------------------------------------------------------ reads */

  async read<T extends Record<string, unknown> = Record<string, unknown>>(
    operationKey: string,
    query: StructuredQuery,
    ctx: CallContext,
  ): Promise<ReadResult<T>> {
    const correlationId = ctx.correlationId ?? randomUUID();
    const op = this.requireOp(operationKey, "GET", ctx.principal) as ReadOp;
    await this.ensureCompanyResolved();

    const built = buildQuery(op.query, query, op.scope?.(ctx.principal) ?? []);
    const url = `${buildOperationUrl(this.deps.cfg, op)}?${built.params.toString()}`;
    this.assertAllowedUrl(url);

    const enumFields = built.select.filter(
      (fld) => op.query.fields[fld]?.type === "enum",
    );
    const load = async () => {
      const rows = await this.getWithRetry<Record<string, unknown>>(
        operationKey,
        op,
        url,
        ctx,
        correlationId,
      );
      // Field-level filtering is enforced here, not delegated to BC honouring $select.
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const fld of built.select) {
          if (!(fld in row)) continue;
          const v = row[fld];
          out[fld] =
            enumFields.includes(fld) && typeof v === "string"
              ? decodeODataEnum(v)
              : v;
        }
        return out as T;
      });
    };
    const r = await this.cache.getOrLoad(
      operationKey,
      built.canonical,
      op.tags,
      ttlFor(op.cache),
      load,
    );
    return { rows: r.value, meta: { source: r.source, correlationId } };
  }

  private async getWithRetry<T>(
    operationKey: string,
    op: ReadOp,
    url: string,
    ctx: CallContext,
    correlationId: string,
  ): Promise<T[]> {
    const { maxRetries } = this.deps.cfg.scheduler;
    let reauthed = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await this.once(
          operationKey,
          op.lane,
          ctx,
          correlationId,
          url,
          { method: "GET" },
          attempt,
        );
        const json = (await res.json()) as { value?: T[] };
        return Array.isArray(json.value) ? json.value : [];
      } catch (e) {
        const err =
          e instanceof GatewayError
            ? e
            : new GatewayError("NETWORK", "Request failed", {
                retryable: true,
              });
        if (err.code === "BC_UNAUTHORIZED" && !reauthed) {
          reauthed = true;
          this.deps.tokens.invalidate();
          continue;
        }
        if (
          !err.retryable ||
          attempt >= maxRetries ||
          err.code === "QUEUE_FULL" ||
          err.code === "CIRCUIT_OPEN" ||
          err.code === "RATE_LIMITED"
        )
          throw err;
        await sleep(
          backoffDelay(attempt, DEFAULT_READ_BACKOFF, err.opts.retryAfterMs),
        );
      }
    }
  }

  /* ----------------------------------------------------------------- writes */

  /**
   * POST a new record. For idempotent operations a body.idempotencyKey is mandatory, and if BC
   * reports a duplicate the stored record is fetched and returned with duplicate=true: the caller
   * treats it as "already submitted", never as a failure and never as a second submission.
   */
  async create(
    operationKey: string,
    body: Record<string, unknown>,
    ctx: CallContext,
  ): Promise<WriteResult> {
    const correlationId = ctx.correlationId ?? randomUUID();
    const op = this.requireOp(operationKey, "POST", ctx.principal) as CreateOp;
    await this.ensureCompanyResolved();
    if (
      op.idempotent &&
      (typeof body.idempotencyKey !== "string" ||
        body.idempotencyKey.length < 16)
    ) {
      throw new GatewayError(
        "INVALID_QUERY",
        "Writes require an idempotencyKey",
      );
    }
    const url = buildOperationUrl(this.deps.cfg, op);
    this.assertAllowedUrl(url);
    const payload = { ...body };
    if (
      operationKey === "transactions.submit" &&
      typeof payload.operationType === "string" &&
      (OPERATION_TYPES as readonly string[]).includes(payload.operationType)
    ) {
      payload.operationType = encodeODataEnum(payload.operationType);
    }

    try {
      const res = await this.once(
        operationKey,
        op.lane,
        ctx,
        correlationId,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        0,
        true,
      );
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      await this.cache.invalidate(op.invalidates);
      return {
        status: res.status,
        body: json,
        duplicate: false,
        meta: { correlationId },
      };
    } catch (e) {
      if (
        e instanceof GatewayError &&
        e.code === "DUPLICATE_SUBMISSION" &&
        op.idempotent
      ) {
        const existing = await this.reconcile(
          String(body.idempotencyKey),
          ctx,
          correlationId,
        );
        if (existing)
          return {
            status: 200,
            body: existing,
            duplicate: true,
            meta: { correlationId },
          };
        throw new GatewayError(
          "OUTCOME_UNKNOWN",
          "The submission may already exist but could not be confirmed",
          { outcomeUnknown: true, correlationId },
        );
      }
      if (e instanceof GatewayError) throw e;
      throw new GatewayError(
        "OUTCOME_UNKNOWN",
        "The result of the submission is unknown",
        { outcomeUnknown: true, correlationId },
      );
    }
  }

  /** Kept for callers that think in terms of "submit a transaction". */
  submit(
    operationKey: string,
    body: Record<string, unknown>,
    ctx: CallContext,
  ): Promise<WriteResult> {
    return this.create(operationKey, body, ctx);
  }

  async patch(
    operationKey: string,
    recordId: string,
    body: Record<string, string | number | boolean | null>,
    ctx: CallContext,
  ): Promise<Record<string, unknown>> {
    const correlationId = ctx.correlationId ?? randomUUID();
    const op = this.requireOp(operationKey, "PATCH", ctx.principal) as PatchOp;
    await this.ensureCompanyResolved();
    for (const [k, v] of Object.entries(body)) {
      const expected = op.fields[k];
      const ok =
        expected === "nullable-string"
          ? v === null || typeof v === "string"
          : typeof v === expected;
      if (!expected || !ok)
        throw new GatewayError(
          "INVALID_QUERY",
          `Field '${k}' cannot be updated`,
        );
    }
    let url: string;
    try {
      url = buildEntityUrl(this.deps.cfg, op, recordId);
    } catch {
      throw new GatewayError("INVALID_QUERY", "Invalid record id");
    }
    this.assertAllowedUrl(url);
    try {
      const res = await this.once(
        operationKey,
        op.lane,
        ctx,
        correlationId,
        url,
        {
          method: "PATCH",
          // API pages require If-Match; "*" means "last writer wins", acceptable for these counters/flags.
          headers: { "Content-Type": "application/json", "If-Match": "*" },
          body: JSON.stringify(body),
        },
        0,
        true,
      );
      await this.cache.invalidate(op.invalidates);
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError(
        "OUTCOME_UNKNOWN",
        "The result of the update is unknown",
        { outcomeUnknown: true, correlationId },
      );
    }
  }

  /** Invokes an unbound AL action. Exactly one attempt; results are parsed, never forwarded raw. */
  async invoke<T = unknown>(
    operationKey: string,
    params: Record<string, string | number>,
    ctx: CallContext,
  ): Promise<T> {
    const correlationId = ctx.correlationId ?? randomUUID();
    const op = this.requireOp(
      operationKey,
      "ACTION",
      ctx.principal,
    ) as ActionOp;
    const names = Object.keys(op.params);
    for (const name of names) {
      if (!(name in params) || typeof params[name] !== op.params[name])
        throw new GatewayError(
          "INVALID_QUERY",
          `Parameter '${name}' is missing or has the wrong type`,
        );
    }
    for (const given of Object.keys(params))
      if (!names.includes(given))
        throw new GatewayError("INVALID_QUERY", `Unknown parameter '${given}'`);

    await this.ensureCompanyResolved();
    const url = buildActionUrl(this.deps.cfg, op);
    this.assertAllowedUrl(url);
    try {
      const res = await this.once(
        operationKey,
        op.lane,
        ctx,
        correlationId,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        },
        0,
        true,
      );
      const json = (await res.json()) as { value?: unknown };
      let value = json.value;

      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // A normal text-returning OData operation may return plain text.
          if (op.returns !== "text") {
            throw new GatewayError(
              "INVALID_QUERY",
              "Business Central returned an invalid JSON response",
              { status: 502, correlationId },
            );
          }
        }
      }

      if (op.returns === "boolean") return Boolean(value) as T;
      if (op.returns === "text") return String(value ?? "") as T;
      return value as T;
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError(
        "OUTCOME_UNKNOWN",
        "The result of the action is unknown",
        { outcomeUnknown: true, correlationId },
      );
    }
  }

  /** Reconciliation lookup: has BC already recorded this idempotency key? (BC upper-cases Code fields.) */
  async findByIdempotencyKey<T extends Record<string, unknown>>(
    key: string,
    ctx: CallContext,
  ): Promise<T | undefined> {
    const r = await this.read<T>(
      "transactions.list",
      { filter: [{ field: "idempotencyKey", op: "eq", value: key }], top: 1 },
      ctx,
    );
    return r.rows[0];
  }

  /** Duplicate handling needs to read the stored record even if the caller only holds submit rights. */
  private reconcile(
    key: string,
    ctx: CallContext,
    correlationId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const principal: Principal = {
      ...ctx.principal,
      permissions: [...ctx.principal.permissions, "transactions:view"],
    };
    return this.findByIdempotencyKey(key, { principal, correlationId });
  }

  /* --------------------------------------------------------------- internals */

  /**
   * Resolves company ID/name from the authenticated standard Business Central companies API.
   * This avoids rejecting a display name supplied as BC_COMPANY_ID and ensures both REST APIs
   * and ODataV4 codeunit actions target the same canonical company returned by BC.
   */
  private async ensureCompanyResolved(): Promise<void> {
    const cfg = this.deps.cfg;
    if (cfg.mode !== "live" || cfg.companyResolved) return;
    this.companyResolution ??= this.resolveCompanyFromBusinessCentral().finally(
      () => {
        this.companyResolution = undefined;
      },
    );
    await this.companyResolution;
  }

  private async resolveCompanyFromBusinessCentral(): Promise<void> {
    const cfg = this.deps.cfg;
    const zeroUuid = "00000000-0000-0000-0000-000000000000";
    const root = `${cfg.apiBaseUrl.replace(/\/+$/, "")}/${cfg.tenantId}/${cfg.envName}`;
    const url = `${root}/api/v2.0/companies?$select=id,name,displayName`;
    this.assertAllowedUrl(url);

    let token: string;
    try {
      token = await this.deps.tokens.getToken();
    } catch (error) {
      throw error instanceof GatewayError
        ? error
        : new GatewayError(
            "BC_UNAUTHORIZED",
            "Could not acquire a Business Central access token. Check BC_TENANT_ID, BC_CLIENT_ID and BC_CLIENT_SECRET.",
          );
    }

    let response: Response;
    try {
      response = await this.transport(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Data-Access-Intent": "ReadOnly",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(cfg.scheduler.requestTimeoutMs),
      });
      if (response.status === 401) {
        this.deps.tokens.invalidate();
        const refreshed = await this.deps.tokens.getToken();
        response = await this.transport(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${refreshed}`,
            Accept: "application/json",
            "Data-Access-Intent": "ReadOnly",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(cfg.scheduler.requestTimeoutMs),
        });
      }
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(
        "NETWORK",
        "Could not reach the Business Central companies API. Check the sandbox environment name and network access.",
        { retryable: true },
      );
    }

    if (!response.ok) {
      const { code, retryable } = classifyStatus(response.status);
      logger.error("bc.company.resolve.failed", {
        status: response.status,
        tenantId: cfg.tenantId,
        environment: cfg.envName,
      });
      throw new GatewayError(
        code,
        response.status === 401 || response.status === 403
          ? "Business Central rejected the application. Verify the Entra application permissions and the WMS integration permission set."
          : `Business Central companies API returned HTTP ${response.status}. Verify BC_ENV_NAME and BC_API_BASE_URL.`,
        {
          status: response.status,
          retryable,
        },
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      value?: Array<{ id?: unknown; name?: unknown; displayName?: unknown }>;
    };
    const companies = Array.isArray(payload.value) ? payload.value : [];
    const configuredId =
      cfg.companyId !== zeroUuid ? cfg.companyId.toLowerCase() : undefined;
    const hint = cfg.companyLookupHint.trim().toLocaleLowerCase();
    const byId = configuredId
      ? companies.find(
          (row) => String(row.id ?? "").toLowerCase() === configuredId,
        )
      : undefined;
    const byName = companies.filter((row) =>
      [row.name, row.displayName].some(
        (n) => typeof n === "string" && n.trim().toLocaleLowerCase() === hint,
      ),
    );
    const company = byId ?? (byName.length === 1 ? byName[0] : undefined);
    const actualId = typeof company?.id === "string" ? company.id : "";
    const actualName =
      typeof company?.name === "string" && company.name.trim()
        ? company.name.trim()
        : typeof company?.displayName === "string"
          ? company.displayName.trim()
          : "";

    if (!company || !zUuid(actualId) || !actualName) {
      throw new GatewayError(
        "BC_NOT_FOUND",
        byName.length > 1
          ? "More than one Business Central company matched BC_COMPANY_NAME. Set BC_COMPANY_ID to the GUID returned by the companies API."
          : "The Business Central connection succeeded, but the configured company was not found. Set BC_COMPANY_NAME to the exact company name or BC_COMPANY_ID to its GUID.",
        {
          status: 404,
        },
      );
    }

    cfg.companyId = actualId;
    cfg.companyName = actualName;
    cfg.companyResolved = true;
    logger.info("bc.company.resolved", {
      companyId: actualId,
      companyName: actualName,
      tenantId: cfg.tenantId,
      environment: cfg.envName,
    });
  }

  private requireOp(
    key: string,
    method: "GET" | "POST" | "PATCH" | "ACTION",
    principal: Principal,
  ) {
    const op = getOperation(key);
    if (!op || op.method !== method)
      throw new GatewayError(
        "ENDPOINT_NOT_ALLOWED",
        "Operation is not permitted",
      );
    if (!principal.permissions.includes(op.permission)) {
      throw new GatewayError(
        "ENDPOINT_NOT_ALLOWED",
        "You do not have permission for this operation",
      );
    }
    return op;
  }

  private assertAllowedUrl(url: string): void {
    const u = new URL(url);
    if (
      this.deps.cfg.mode === "live" &&
      (u.protocol !== "https:" || u.host !== this.host)
    ) {
      throw new GatewayError(
        "ENDPOINT_NOT_ALLOWED",
        "Target host is not permitted",
      );
    }
  }

  /** One scheduled attempt. Maps HTTP/transport failures to GatewayError and reports breaker outcome. */
  private async once(
    operationKey: string,
    lane: Lane,
    ctx: CallContext,
    correlationId: string,
    url: string,
    init: RequestInit,
    attempt: number,
    isWrite = false,
  ): Promise<Response> {
    const { scheduler, tokens, cfg } = this.deps;
    return scheduler.run(
      lane,
      { operation: operationKey, userId: ctx.principal.userId },
      async ({ queueWaitMs }) => {
        const started = Date.now();
        const token = await tokens.getToken();
        const headers: Record<string, string> = {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.method === "GET"
            ? { "Data-Access-Intent": "ReadOnly" }
            : {}),
        };
        if (process.env.WMS_BC_DEBUG_REQUESTS === "true") {
          let bodyForLog: unknown = null;
          if (typeof init.body === "string") {
            try {
              bodyForLog = JSON.parse(init.body) as unknown;
            } catch {
              bodyForLog = "[non-JSON body omitted]";
            }
          }
          // logger redacts fields named password/token/secret/authorization/cookie.
          logger.info("bc.debug.outgoing_request", {
            correlationId,
            operation: operationKey,
            url,
            method: init.method ?? "GET",
            headers,
            body: bodyForLog,
          });
        }

        let res: Response;
        try {
          res = await this.transport(url, {
            ...init,
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(cfg.scheduler.requestTimeoutMs),
          });
        } catch (e) {
          scheduler.reportOutcome(false);
          const timedOut =
            e instanceof Error &&
            (e.name === "TimeoutError" || e.name === "AbortError");
          const durationMs = Date.now() - started;

          metrics.request(operationKey, durationMs, queueWaitMs, "error");
          logger.warn("bc.request.transport_error", {
            correlationId,
            operation: operationKey,
            durationMs,
            queueWaitMs,
            retryCount: attempt,
            errorCode: timedOut ? "TIMEOUT" : "NETWORK",
          });
          // A write that may have reached BC must never be reported as a plain failure.
          throw new GatewayError(
            timedOut ? "TIMEOUT" : "NETWORK",
            "Could not complete the request to Business Central",
            {
              retryable: !isWrite,
              outcomeUnknown: isWrite,
              correlationId,
            },
          );
        }

        const durationMs = Date.now() - started;
        if (process.env.WMS_BC_DEBUG_REQUESTS === "true") {
          logger.info("bc.debug.outgoing_response", {
            correlationId,
            operation: operationKey,
            url,
            status: res.status,
            durationMs,
          });
        }
        if (res.ok) {
          scheduler.reportOutcome(true);
          metrics.request(operationKey, durationMs, queueWaitMs, "ok");
          (lane === "background" ? logger.debug : logger.info)("bc.request", {
            correlationId,
            operation: operationKey,
            userId: ctx.principal.userId,
            status: res.status,
            durationMs,
            queueWaitMs,
            retryCount: attempt,
          });
          return res;
        }

        // The body is read only to detect our own marker; it is never logged or forwarded.
        const errorBody = (await res.text().catch(() => "")).slice(
          0,
          MAX_ERROR_BODY,
        );
        const duplicate =
          isWrite && res.status === 400 && errorBody.includes(DUPLICATE_MARKER);
        const bcMessage = extractBcMessage(errorBody, res.status);

        const { code, retryable } = classifyStatus(res.status);
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        const healthy =
          res.status < 500 && res.status !== 429 && res.status !== 408;
        scheduler.reportOutcome(healthy);
        metrics.request(
          operationKey,
          durationMs,
          queueWaitMs,
          res.status === 429 ? "throttled" : "error",
        );
        logger.warn("bc.request.error", {
          bcMessage,
          correlationId,
          operation: operationKey,
          userId: ctx.principal.userId,
          status: res.status,
          durationMs,
          queueWaitMs,
          retryCount: attempt,
          errorCode: duplicate ? "DUPLICATE_SUBMISSION" : code,
        });

        if (duplicate)
          throw new GatewayError(
            "DUPLICATE_SUBMISSION",
            "Transaction already submitted",
            { status: 400, correlationId },
          );
        const ambiguous = isWrite && [408, 502, 503, 504].includes(res.status);
        throw new GatewayError(
          ambiguous ? "OUTCOME_UNKNOWN" : code,
          bcMessage ?? "Business Central rejected the request",
          {
            status: res.status,
            retryable: isWrite ? false : retryable,
            retryAfterMs,
            outcomeUnknown: ambiguous,
            correlationId,
          },
        );
      },
    );
  }
}

/**
 * Business Central returns AL Error() text as {"error":{"code","message"}}. Those texts are written
 * for users (for example "WMS user X does not have permission picking:submit."), so a short,
 * single-line copy is passed on for client errors. Server faults and anything long stay generic.
 */
export function extractBcMessage(body: string, status: number): string | undefined {
  if (status >= 500 || status === 401 || status === 403) return undefined;
  try {
    const m = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    if (typeof m !== "string") return undefined;
    const clean = m.replace(/\s+/g, " ").replace(/CorrelationId:.*$/i, "").trim();
    return clean && clean.length <= 300 ? `Business Central: ${clean}` : undefined;
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------- singleton */

export function getScheduler(): RequestScheduler {
  return singleton("scheduler", () => {
    const cfg = getConfig();
    return new RequestScheduler(cfg.scheduler, getCoordinator(cfg.redisUrl));
  });
}

export function getGateway(): BcGateway {
  return singleton("gateway", () => {
    const cfg = getConfig();
    const mock = cfg.mode === "mock" ? new MockBc() : undefined;
    const gw = new BcGateway({
      cfg,
      coordinator: getCoordinator(cfg.redisUrl),
      scheduler: getScheduler(),
      tokens: getTokenManager(),
      mock,
    });
    if (mock)
      void import("./dev-worker").then((m) => m.startDevWorker(gw, mock));
    return gw;
  });
}

import "server-only";
import { randomBytes } from "node:crypto";
import { BC_GUID_RE } from "./guid";
import { z } from "zod";

/**
 * Validated, server-only configuration. The browser can never select tenant,
 * company, environment, host or path: everything is fixed here at startup.
 *
 * Compatibility layer (documented): the non-secret identifiers may also be
 * supplied through NEXT_PUBLIC_BC_TENANT_ID / _CLIENT_ID / _COMPANY_ID.
 * Secrets and legacy aliases (NEXT_ENV_NAME, NEXT_COMP_NAME,
 * NEXT_PUBLIC_BC_CLIENT_SECRET) are rejected, not silently honoured.
 */

const nonEmptyEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const uuidFromEnv = (values: Array<string | undefined>, mock: boolean, zeroUuid: string): string | undefined => {
  const value = values.map(nonEmptyEnv).find((candidate) => candidate !== undefined);
  if (mock && (!value || !z.string().uuid().safeParse(value).success)) return zeroUuid;
  return value;
};

const intFromEnv = (def: number, min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? def : Number(v)),
    z.number().int().min(min).max(max),
  );

const schema = z.object({
  mode: z.enum(["mock", "live"]),
  nodeEnv: z.enum(["development", "test", "production"]),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1),
  companyId: z.string().regex(BC_GUID_RE, "must be the Business Central company GUID from the companies API, not the display name"),
  companyName: z.string().min(1).max(100),
  companyLookupHint: z.string().min(1).max(200),
  companyResolved: z.boolean(),
  envName: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  apiBaseUrl: z.string().url().refine((u) => u.startsWith("https://"), "must be https"),
  scope: z.string().url(),
  sessionSecret: z.string().min(32, "must be at least 32 characters; set WMS_SESSION_SECRET in .env.local"),
  sessionIdleMinutes: intFromEnv(30, 1, 480),
  sessionAbsoluteHours: intFromEnv(12, 1, 72),
  redisUrl: z.string().optional(),
  scheduler: z.object({
    maxConcurrent: intFromEnv(4, 1, 64),
    maxReads: intFromEnv(3, 1, 64),
    maxWrites: intFromEnv(2, 1, 64),
    maxBackground: intFromEnv(1, 1, 64),
    maxQueueInteractive: intFromEnv(200, 1, 100_000),
    maxQueueWrite: intFromEnv(200, 1, 100_000),
    maxQueueBackground: intFromEnv(100, 1, 100_000),
    ratePerSecond: intFromEnv(10, 1, 1000),
    requestTimeoutMs: intFromEnv(20_000, 1000, 120_000),
    maxRetries: intFromEnv(2, 0, 5),
    userRatePerMinute: intFromEnv(240, 1, 100_000),
    instanceCount: intFromEnv(1, 1, 1000),
  }),
});

export type WmsConfig = z.infer<typeof schema>;

const FORBIDDEN_ENV: Record<string, string> = {
  NEXT_PUBLIC_BC_CLIENT_SECRET: "Secrets must never use NEXT_PUBLIC_. Use BC_CLIENT_SECRET (server-only).",
  NEXT_PUBLIC_BC_SECRET: "Secrets must never use NEXT_PUBLIC_. Use BC_CLIENT_SECRET (server-only).",
  NEXT_ENV_NAME: "Legacy alias. Use BC_ENV_NAME.",
  NEXT_COMP_NAME: "Legacy alias. Use BC_COMPANY_NAME.",
};

type WmsRuntimeGlobal = typeof globalThis & { __wmsDevelopmentSessionSecret?: string };
const runtimeGlobal = globalThis as WmsRuntimeGlobal;

function developmentSessionSecret(): string {
  // Keep this stable across Next.js development hot reloads. A full process restart
  // intentionally rotates it; set WMS_SESSION_SECRET in .env.local for persistence.
  runtimeGlobal.__wmsDevelopmentSessionSecret ??= randomBytes(32).toString("base64url");
  return runtimeGlobal.__wmsDevelopmentSessionSecret;
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid WMS configuration:\n - ${issues.join("\n - ")}`);
    this.name = "ConfigError";
  }
}

export function parseConfig(env: Record<string, string | undefined>): WmsConfig {
  const issues: string[] = [];

  for (const [name, hint] of Object.entries(FORBIDDEN_ENV)) {
    if (env[name]) issues.push(`${name} is set. ${hint}`);
  }

  const mode = nonEmptyEnv(env.WMS_BC_MODE)?.toLowerCase() ?? "mock";
  const nodeEnv = nonEmptyEnv(env.NODE_ENV) ?? "development";
  if (nodeEnv === "production" && mode !== "live") {
    issues.push("WMS_BC_MODE must be 'live' in production. Mock data is never served silently in production.");
  }

  const mock = mode === "mock";
  const zeroUuid = "00000000-0000-0000-0000-000000000000";
  const companyIdHint = nonEmptyEnv(env.BC_COMPANY_ID) ?? nonEmptyEnv(env.NEXT_PUBLIC_BC_COMPANY_ID) ?? "";
  const companyIdIsGuid = Boolean(companyIdHint && BC_GUID_RE.test(companyIdHint));
  const companyIdLooksLikeGuid = companyIdIsGuid && companyIdHint !== zeroUuid;
  const companyNameEnv = nonEmptyEnv(env.BC_COMPANY_NAME);
  const companyNameLooksLikeExample = !companyNameEnv || /^(my company|your company|company name|replace-me)$/i.test(companyNameEnv);
  // Prefer a real explicit company name, but don't let the .env.example placeholder
  // shadow a company display name accidentally placed in BC_COMPANY_ID.
  const companyLookupHint = !companyNameLooksLikeExample
    ? companyNameEnv!
    : companyIdHint && !companyIdIsGuid
      ? companyIdHint
      : companyIdLooksLikeGuid
        ? companyIdHint
        : companyNameEnv ?? "";

  if (!mock) {
    const tenantCandidate = nonEmptyEnv(env.BC_TENANT_ID) ?? nonEmptyEnv(env.NEXT_PUBLIC_BC_TENANT_ID);
    const clientCandidate = nonEmptyEnv(env.BC_CLIENT_ID) ?? nonEmptyEnv(env.NEXT_PUBLIC_BC_CLIENT_ID);
    if (!tenantCandidate || tenantCandidate === zeroUuid) issues.push("tenantId: set BC_TENANT_ID to the real Microsoft Entra tenant GUID, not the .env.example placeholder");
    if (!clientCandidate || clientCandidate === zeroUuid) issues.push("clientId: set BC_CLIENT_ID to the real Entra application/client GUID, not the .env.example placeholder");
    if ((nonEmptyEnv(env.BC_CLIENT_SECRET) ?? "") === "replace-me") issues.push("clientSecret: replace the .env.example placeholder with the Entra client secret value");
    if (!companyLookupHint || (companyNameLooksLikeExample && !companyIdLooksLikeGuid && !(companyIdHint && !companyIdIsGuid))) issues.push("companyName: replace the .env.example placeholder with the exact Business Central company name, or set BC_COMPANY_ID to its GUID from /api/v2.0/companies");
  }

  const configuredSessionSecret = nonEmptyEnv(env.WMS_SESSION_SECRET);
  // Local development may connect to a live BC sandbox. It must still start even when the
  // session secret was omitted; use a process-stable development secret. Production remains strict.
  const canGenerateDevelopmentSecret = nodeEnv !== "production";
  const effectiveSessionSecret = configuredSessionSecret && configuredSessionSecret.length >= 32
    ? configuredSessionSecret
    : canGenerateDevelopmentSecret
      ? developmentSessionSecret()
      : configuredSessionSecret;

  const raw = {
    mode,
    nodeEnv,
    // BC identity values do not participate in mock-mode requests. Ignore
    // stale/blank placeholders in .env.local while mock mode is selected.
    tenantId: uuidFromEnv([env.BC_TENANT_ID, env.NEXT_PUBLIC_BC_TENANT_ID], mock, zeroUuid),
    clientId: uuidFromEnv([env.BC_CLIENT_ID, env.NEXT_PUBLIC_BC_CLIENT_ID], mock, zeroUuid),
    clientSecret: nonEmptyEnv(env.BC_CLIENT_SECRET) ?? (mock ? "mock-secret" : undefined),
    // A company display name is accepted as a lookup hint. The live gateway resolves the
    // canonical GUID from /api/v2.0/companies before using any company-scoped endpoint.
    companyId: companyIdLooksLikeGuid
      ? companyIdHint
      : (mock ? zeroUuid : zeroUuid),
    companyName: mock ? "Mock Company" : (companyLookupHint || companyNameEnv || "Unresolved Company"),
    companyLookupHint: companyLookupHint || (mock ? "Mock Company" : ""),
    // If a valid company GUID was explicitly configured, do not make a preliminary
    // /api/v2.0/companies request. Codeunit/API calls can use that GUID directly.
    companyResolved: mock || companyIdLooksLikeGuid,
    envName: nonEmptyEnv(env.BC_ENV_NAME) ?? (mock ? "mock" : undefined),
    apiBaseUrl: nonEmptyEnv(env.BC_API_BASE_URL) ?? "https://api.businesscentral.dynamics.com/v2.0",
    scope: nonEmptyEnv(env.BC_SCOPE) ?? "https://api.businesscentral.dynamics.com/.default",
    // In development (mock or live sandbox), empty/short values use a process-stable
    // secret. In production, an explicit 32+ character WMS_SESSION_SECRET is mandatory.
    sessionSecret: effectiveSessionSecret ?? "",
    sessionIdleMinutes: env.WMS_SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: env.WMS_SESSION_ABSOLUTE_HOURS,
    redisUrl: env.REDIS_URL || undefined,
    scheduler: {
      maxConcurrent: env.WMS_BC_MAX_CONCURRENT,
      maxReads: env.WMS_BC_MAX_READS,
      maxWrites: env.WMS_BC_MAX_WRITES,
      maxBackground: env.WMS_BC_MAX_BACKGROUND,
      maxQueueInteractive: env.WMS_BC_MAX_QUEUE_INTERACTIVE,
      maxQueueWrite: env.WMS_BC_MAX_QUEUE_WRITE,
      maxQueueBackground: env.WMS_BC_MAX_QUEUE_BACKGROUND,
      ratePerSecond: env.WMS_BC_RATE_PER_SECOND,
      requestTimeoutMs: env.WMS_BC_REQUEST_TIMEOUT_MS,
      maxRetries: env.WMS_BC_MAX_RETRIES,
      userRatePerMinute: env.WMS_USER_RATE_PER_MINUTE,
      instanceCount: env.WMS_INSTANCE_COUNT,
    },
  };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push(`${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  if (issues.length > 0 || !parsed.success) throw new ConfigError(issues);
  return parsed.data;
}

let cached: WmsConfig | undefined;

export function getConfig(): WmsConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Test helper. */
export function resetConfigForTests(): void {
  cached = undefined;
}

/** Host that BC requests may target. Used by the gateway as an SSRF guard. */
export function allowedBcHost(cfg: WmsConfig): string {
  return new URL(cfg.apiBaseUrl).host;
}

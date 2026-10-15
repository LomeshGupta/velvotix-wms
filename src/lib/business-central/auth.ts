import "server-only";
import { singleton } from "@/lib/singleton";
import { getConfig, type WmsConfig } from "./config";
import { GatewayError } from "./errors";
import { logger } from "@/lib/telemetry/logger";
import { metrics } from "@/lib/telemetry/metrics";

/**
 * Server-only OAuth2 client-credentials token manager.
 * - The token never leaves this module except as an Authorization header on
 *   requests to the allow-listed BC host. There is no route that returns it.
 * - Single-flight: concurrent callers share one in-flight acquisition.
 * - Refreshes `refreshMarginMs` before expiry.
 * Each instance acquires its own token (Entra issues these freely); tokens are
 * deliberately NOT shared through Redis to avoid persisting a bearer credential.
 */

interface CachedToken {
  value: string;
  expiresAt: number;
}

export interface TokenManagerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshMarginMs?: number;
  timeoutMs?: number;
}

export class TokenManager {
  private cached: CachedToken | undefined;
  private inflight: Promise<CachedToken> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly margin: number;
  private readonly timeoutMs: number;
  acquisitions = 0;

  constructor(private readonly cfg: WmsConfig, opts: TokenManagerOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.margin = opts.refreshMarginMs ?? 5 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async getToken(): Promise<string> {
    if (this.cfg.mode === "mock") return "mock-token";
    const c = this.cached;
    if (c && c.expiresAt - this.now() > this.margin) return c.value;
    this.inflight ??= this.acquire().finally(() => {
      this.inflight = undefined;
    });
    return (await this.inflight).value;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async acquire(): Promise<CachedToken> {
    this.acquisitions += 1;
    const url = `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: this.cfg.scope,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      metrics.authFailure();
      throw new GatewayError("NETWORK", "Could not reach the identity provider", { retryable: true });
    }
    if (!res.ok) {
      metrics.authFailure();
      // The response body is intentionally not logged or returned: it can echo client details.
      logger.error("bc.token.failed", { status: res.status });
      throw new GatewayError("BC_UNAUTHORIZED", "Business Central authentication failed", {
        status: res.status,
        retryable: res.status >= 500,
      });
    }
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    const expiresIn = Number(json.expires_in);
    if (typeof json.access_token !== "string" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      metrics.authFailure();
      throw new GatewayError("BC_UNAUTHORIZED", "Identity provider returned an invalid token response");
    }
    this.cached = { value: json.access_token, expiresAt: this.now() + expiresIn * 1000 };
    return this.cached;
  }
}

export function getTokenManager(): TokenManager {
  return singleton("tokenManager", () => new TokenManager(getConfig()));
}

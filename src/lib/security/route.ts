import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ConfigError, getConfig } from "@/lib/business-central/config";
import { isGatewayError } from "@/lib/business-central/errors";
import { logger } from "@/lib/telemetry/logger";
import type { Principal } from "@/types/principal";
import { getSessionStore, getUserDirectory } from "./services";
import { SESSION_COOKIE, validateSession, verifyCsrf } from "./session";

export interface RouteContext {
  req: NextRequest;
  /** Resolved dynamic route segments (Next.js 16 passes them as a promise). */
  params: Record<string, string>;
  principal: Principal;
  /** Hash of the session token; used for CSRF and revocation. */
  sessionIdHash: string;
  correlationId: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CORRELATION_RE = /^[A-Za-z0-9-]{8,64}$/;

export function correlationIdFor(req: NextRequest): string {
  const h = req.headers.get("x-correlation-id");
  return h && CORRELATION_RE.test(h) ? h : randomUUID();
}

export function jsonError(status: number, code: string, message: string, correlationId: string, extra?: HeadersInit): NextResponse {
  return NextResponse.json({ error: { code, message, correlationId } }, { status, headers: extra });
}

/** Maps any thrown value to a safe response. Internals never reach the client. */
export function errorResponse(e: unknown, correlationId: string): NextResponse {
  if (isGatewayError(e)) {
    const headers: Record<string, string> = {};
    if (e.opts.retryAfterMs) headers["Retry-After"] = String(Math.max(1, Math.ceil(e.opts.retryAfterMs / 1000)));
    return jsonError(e.httpStatus, e.code, e.message, correlationId, headers);
  }
  if (e instanceof ZodError) return jsonError(400, "VALIDATION", "Invalid request", correlationId);
  if (e instanceof ConfigError) {
    logger.error("route.config_invalid", { correlationId, errorCode: "CONFIG", detail: e.issues.join(" | ").slice(0, 600) });
    return jsonError(503, "CONFIG", "The WMS server configuration is incomplete. An administrator must check the server log for this reference.", correlationId);
  }
  // Server log only (never returned to the browser): the real cause, so "Unexpected error" is traceable.
  logger.error("route.unhandled", {
    correlationId,
    errorCode: e instanceof Error ? e.name : "unknown",
    detail: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    stack: e instanceof Error ? e.stack?.split("\n").slice(0, 6).join(" | ") : undefined,
  });
  return jsonError(500, "INTERNAL", "Unexpected error. Quote the reference to your administrator.", correlationId);
}

function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // state-changing requests from browsers always carry Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Wraps a protected route: session -> user status -> permission -> CSRF (unsafe
 * methods) -> handler. Authorization data always comes from the server-side user
 * record, never from anything the client sent.
 */
export function protectedRoute(
  opts: { permission?: string },
  handler: (ctx: RouteContext) => Promise<Response>,
): (req: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }) => Promise<Response> {
  return async (req, routeCtx) => {
    const correlationId = correlationIdFor(req);
    try {
      const cfg = getConfig();
      const directory = getUserDirectory();

      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const check = await validateSession(getSessionStore(), token, {
        idleMs: cfg.sessionIdleMinutes * 60_000,
        absoluteMs: cfg.sessionAbsoluteHours * 3_600_000,
      });
      if (!check.ok) return jsonError(401, "UNAUTHENTICATED", "Please sign in", correlationId);

      const user = await directory.findProfile(check.record.userId);
      if (!user || user.status !== "Active") return jsonError(401, "UNAUTHENTICATED", "Please sign in", correlationId);

      if (!SAFE_METHODS.has(req.method)) {
        if (!originAllowed(req) || !verifyCsrf(cfg.sessionSecret, check.record.idHash, req.headers.get("x-csrf-token"))) {
          return jsonError(403, "CSRF", "Request could not be verified", correlationId);
        }
      }

      if (opts.permission && !user.permissions.includes(opts.permission)) {
        return jsonError(403, "FORBIDDEN", "You do not have permission for this action", correlationId);
      }

      const now = Date.now();
      if (now - check.record.lastSeenAt > 30_000) await getSessionStore().touch(check.record.idHash, now);

      const principal: Principal = {
        userId: user.userId,
        displayName: user.displayName,
        roles: user.roles ?? [],
        permissions: user.permissions,
        warehouseCodes: user.warehouseCodes,
        sessionId: check.record.idHash.slice(0, 12),
      };
      const params = routeCtx ? await routeCtx.params : {};
      const res = await handler({ req, params, principal, sessionIdHash: check.record.idHash, correlationId });
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (e) {
      return errorResponse(e, correlationId);
    }
  };
}

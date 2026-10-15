import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@/lib/business-central/config";
import { getCoordinator } from "@/lib/business-central/coordinator";
import {
  correlationIdFor,
  errorResponse,
  jsonError,
} from "@/lib/security/route";
import { getSessionStore, getUserDirectory } from "@/lib/security/services";
import {
  csrfTokenFor,
  hashToken,
  newSessionToken,
  SESSION_COOKIE,
} from "@/lib/security/session";
import { logger } from "@/lib/telemetry/logger";
import { metrics } from "@/lib/telemetry/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const GENERIC = "Invalid user ID or password";

export async function POST(req: NextRequest): Promise<Response> {
  const correlationId = correlationIdFor(req);

  try {
    const cfg = getConfig();
    const { userId, password } = Body.parse(await req.json().catch(() => ({})));

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);

    // Brute-force throttling.
    const coord = getCoordinator(cfg.redisUrl);

    const waits = await Promise.all([
      coord.takeToken(`login:u:${userId.toLowerCase()}`, 1 / 60, 5),
      coord.takeToken(`login:ip:${ipHash}`, 1 / 6, 30),
    ]);

    const wait = Math.max(...waits);

    if (wait > 0) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "Too many attempts. Try again later.",
        correlationId,
        { "Retry-After": String(Math.ceil(wait / 1000)) },
      );
    }

    // The directory must call the configured authentication provider:
    // Business Central in live mode, or the local demo directory in mock mode.
    const directory = getUserDirectory();
    const user = await directory.authenticate(userId, password);

    if (!user || user.status !== "Active") {
      metrics.authFailure();

      logger.warn("auth.login.failed", {
        correlationId,
        userId: userId.slice(0, 64),
      });

      return jsonError(401, "INVALID_CREDENTIALS", GENERIC, correlationId);
    }

    // A valid password is not enough to enter WMS. Never create a session that
    // cannot access any protected page because BC has no effective permissions.
    if (user.permissions.length === 0) {
      logger.warn("auth.login.no_permissions", {
        correlationId,
        userId: user.userId,
        rolesCount: user.roles?.length ?? 0,
        warehouseCount: user.warehouseCodes.length,
      });
      return jsonError(
        403,
        "NO_WMS_PERMISSIONS",
        "Your credentials are valid, but no WMS permissions are assigned. Assign an enabled WMS role with permissions or add direct permissions in Business Central.",
        correlationId,
      );
    }

    // Create a new server-side session after successful authentication.
    const token = newSessionToken();
    const idHash = hashToken(token);
    const now = Date.now();

    await getSessionStore().create({
      idHash,
      userId: user.userId,
      createdAt: now,
      lastSeenAt: now,
      ipHash,
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
      revoked: false,
    });

    logger.info("auth.login.success", {
      correlationId,
      userId: user.userId,
    });

    const res = NextResponse.json({
      user: {
        userId: user.userId,
        displayName: user.displayName,
        roles: user.roles ?? [],
        permissions: user.permissions,
        warehouseCodes: user.warehouseCodes,
        mustChangePassword: user.mustChangePassword,
      },
      csrfToken: csrfTokenFor(cfg.sessionSecret, idHash),
    });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: cfg.sessionAbsoluteHours * 3600,
    });

    res.headers.set("x-correlation-id", correlationId);
    return res;
  } catch (error) {
    logger.error("auth.login.error", {
      correlationId,
      error:
        error instanceof Error ? error.message : "Unknown authentication error",
    });

    return errorResponse(error, correlationId);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { correlationIdFor, jsonError } from "@/lib/security/route";
import { getSessionStore } from "@/lib/security/services";
import { hashToken, SESSION_COOKIE } from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Logout is a deliberately narrow exception to the normal CSRF-token check:
 * it can only revoke the current cookie's session and it still requires a
 * same-origin browser request. This lets a user securely sign out after a
 * session-secret/env reload has invalidated the in-memory CSRF token.
 */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const correlationId = correlationIdFor(req);
  if (!sameOrigin(req)) {
    return jsonError(403, "CSRF", "Request could not be verified", correlationId);
  }

  // Session IDs are stored as SHA-256 hashes of the cookie token, so revoking
  // does not require loading the rest of application configuration.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let revocationFailed = false;
  if (token) {
    try {
      await getSessionStore().revoke(hashToken(token));
    } catch {
      // Clear the browser cookie even if the server-side store/config is offline,
      // but report the failure so operators don't mistake it for server revocation.
      revocationFailed = true;
    }
  }

  const res = revocationFailed
    ? jsonError(503, "LOGOUT_REVOCATION_UNAVAILABLE", "Your browser session was cleared, but the server could not confirm session revocation. Fix WMS configuration and sign in again.", correlationId)
    : NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}

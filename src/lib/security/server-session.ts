import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/business-central/config";
import type { Principal } from "@/types/principal";
import { getSessionStore, getUserDirectory } from "./services";
import { csrfTokenFor, SESSION_COOKIE, validateSession } from "./session";

export interface ServerSession {
  principal: Principal;
  csrfToken: string;
  mockMode: boolean;
  mustChangePassword: boolean;
}

/** For server components/layouts: resolves the current session or returns null (caller redirects). */
export async function getServerSession(): Promise<ServerSession | null> {
  const cfg = getConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const check = await validateSession(getSessionStore(), token, {
    idleMs: cfg.sessionIdleMinutes * 60_000,
    absoluteMs: cfg.sessionAbsoluteHours * 3_600_000,
  });
  if (!check.ok) return null;
  const user = await getUserDirectory().findProfile(check.record.userId);
  if (!user || user.status !== "Active") return null;
  return {
    principal: { userId: user.userId, displayName: user.displayName, roles: user.roles ?? [], permissions: user.permissions, warehouseCodes: user.warehouseCodes, sessionId: check.record.idHash.slice(0, 12) },
    csrfToken: csrfTokenFor(cfg.sessionSecret, check.record.idHash),
    mockMode: cfg.mode === "mock",
    mustChangePassword: user.mustChangePassword,
  };
}

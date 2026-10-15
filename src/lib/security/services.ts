import "server-only";
import { getGateway } from "@/lib/business-central/client";
import { getConfig } from "@/lib/business-central/config";
import { getCoordinator } from "@/lib/business-central/coordinator";
import { BcSessionStore } from "./bc-session-store";
import { BcUserDirectory } from "./bc-user-directory";
import { MemorySessionStore, type SessionStore } from "./session";
import { MockUserDirectory, type UserDirectory } from "./user-directory";

/**
 * Live mode: sessions and users live in Business Central (VWMS Session / VWMS User tables), so
 * revocation, concurrent-session visibility and suspension work across every instance.
 * Mock mode: in-process stand-ins for local development only (config forbids mock in production).
 *
 * Cached on globalThis so Next.js dev hot-reloads do not drop mock sessions.
 */
const g = globalThis as unknown as { __wmsSessions?: SessionStore; __wmsDirectory?: UserDirectory };

export function getSessionStore(): SessionStore {
  if (!g.__wmsSessions) {
    const cfg = getConfig();
    g.__wmsSessions = cfg.mode === "live" ? new BcSessionStore(getGateway(), getCoordinator(cfg.redisUrl)) : new MemorySessionStore();
  }
  return g.__wmsSessions;
}

export function getUserDirectory(): UserDirectory {
  if (!g.__wmsDirectory) {
    const cfg = getConfig();
    g.__wmsDirectory = cfg.mode === "live" ? new BcUserDirectory(getGateway(), getCoordinator(cfg.redisUrl)) : new MockUserDirectory();
  }
  return g.__wmsDirectory;
}

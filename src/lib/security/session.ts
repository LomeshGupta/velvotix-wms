import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionRecord {
  /** sha256 of the opaque token; the raw token exists only in the cookie. */
  idHash: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  ipHash: string;
  userAgent: string;
  revoked: boolean;
}

/** Phase 3 adds a Business Central-backed store (revocation, concurrent-session view). */
export interface SessionStore {
  create(rec: SessionRecord): Promise<void>;
  get(idHash: string): Promise<SessionRecord | undefined>;
  touch(idHash: string, at: number): Promise<void>;
  revoke(idHash: string): Promise<void>;
  listForUser(userId: string): Promise<SessionRecord[]>;
}

export class MemorySessionStore implements SessionStore {
  private map = new Map<string, SessionRecord>();
  async create(rec: SessionRecord) { this.map.set(rec.idHash, rec); }
  async get(idHash: string) { return this.map.get(idHash); }
  async touch(idHash: string, at: number) { const r = this.map.get(idHash); if (r) r.lastSeenAt = at; }
  async revoke(idHash: string) { const r = this.map.get(idHash); if (r) r.revoked = true; }
  async listForUser(userId: string) { return [...this.map.values()].filter((r) => r.userId === userId && !r.revoked); }
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
}

export type SessionCheck =
  | { ok: true; record: SessionRecord }
  | { ok: false; reason: "missing" | "revoked" | "idle" | "absolute" };

export async function validateSession(
  store: SessionStore,
  token: string | undefined,
  policy: SessionPolicy,
  now = Date.now(),
): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const rec = await store.get(hashToken(token));
  if (!rec) return { ok: false, reason: "missing" };
  if (rec.revoked) return { ok: false, reason: "revoked" };
  if (now - rec.createdAt > policy.absoluteMs) return { ok: false, reason: "absolute" };
  if (now - rec.lastSeenAt > policy.idleMs) return { ok: false, reason: "idle" };
  return { ok: true, record: rec };
}

/** Per-session CSRF token: HMAC(secret, session hash). Not stored; recomputed and compared in constant time. */
export function csrfTokenFor(secret: string, idHash: string): string {
  return createHmac("sha256", secret).update(`csrf:${idHash}`).digest("base64url");
}

export function verifyCsrf(secret: string, idHash: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(csrfTokenFor(secret, idHash));
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-wms_sid" : "wms_sid";

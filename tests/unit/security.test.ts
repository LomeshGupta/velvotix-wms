import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/security/password";
import { csrfTokenFor, hashToken, MemorySessionStore, newSessionToken, validateSession, verifyCsrf } from "@/lib/security/session";
import { MockUserDirectory } from "@/lib/security/user-directory";
import { isValidIdempotencyKey, payloadFingerprint, scopedIdempotencyKey } from "@/lib/business-central/idempotency";

const policy = { idleMs: 30 * 60_000, absoluteMs: 12 * 3_600_000 };

async function seeded(now = 1_000_000) {
  const store = new MemorySessionStore();
  const token = newSessionToken();
  await store.create({ idHash: hashToken(token), userId: "u", createdAt: now, lastSeenAt: now, ipHash: "i", userAgent: "ua", revoked: false });
  return { store, token };
}

describe("passwords", () => {
  it("hashes with Argon2id, verifies, and never stores plaintext", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
  });
  it("enforces a minimum length", () => {
    expect(validatePasswordStrength("short")).toBeDefined();
    expect(validatePasswordStrength("long enough password")).toBeUndefined();
  });
  it("provides demo role accounts only in non-production mock mode", async () => {
    const directory = new MockUserDirectory({ NODE_ENV: "development", WMS_BC_MODE: "mock" });
    expect((await directory.findForLogin("admin"))?.userId).toBe("ADMIN");
    expect((await directory.findForLogin("manager"))?.userId).toBe("MANAGER");
    expect((await directory.findForLogin("receiver"))?.userId).toBe("RECEIVER");
    expect((await directory.findForLogin("picker"))?.userId).toBe("PICKER");
    expect((await directory.findForLogin("shipper"))?.userId).toBe("SHIPPER");
    expect((await directory.findForLogin("auditor"))?.userId).toBe("AUDITOR");
    expect(await new MockUserDirectory({ NODE_ENV: "production", WMS_BC_MODE: "mock" }).findForLogin("admin")).toBeUndefined();
    expect(await new MockUserDirectory({ NODE_ENV: "development", WMS_BC_MODE: "live" }).findForLogin("admin")).toBeUndefined();
  });
  it("allows development mock passwords to be overridden", async () => {
    expect((await new MockUserDirectory({ NODE_ENV: "development", WMS_BC_MODE: "mock", WMS_MOCK_ADMIN_PASSWORD: "a-long-test-password" }).findForLogin("admin"))?.userId).toBe("ADMIN");
  });
});

describe("sessions", () => {
  it("accepts a fresh session and rejects missing tokens", async () => {
    const { store, token } = await seeded();
    expect((await validateSession(store, token, policy, 1_000_500)).ok).toBe(true);
    expect(await validateSession(store, undefined, policy)).toEqual({ ok: false, reason: "missing" });
    expect(await validateSession(store, "forged", policy)).toEqual({ ok: false, reason: "missing" });
  });
  it("expires on idle and on absolute lifetime", async () => {
    const { store, token } = await seeded();
    expect(await validateSession(store, token, policy, 1_000_000 + 31 * 60_000)).toEqual({ ok: false, reason: "idle" });
    await store.touch(hashToken(token), 1_000_000 + 12 * 3_600_000);
    expect(await validateSession(store, token, policy, 1_000_000 + 12 * 3_600_000 + 1000)).toEqual({ ok: false, reason: "absolute" });
  });
  it("honours revocation", async () => {
    const { store, token } = await seeded();
    await store.revoke(hashToken(token));
    expect(await validateSession(store, token, policy, 1_000_100)).toEqual({ ok: false, reason: "revoked" });
  });
  it("issues a different token per login (no fixation) and stores only a hash", async () => {
    expect(newSessionToken()).not.toBe(newSessionToken());
    expect(hashToken("abc")).not.toBe("abc");
  });
});

describe("csrf", () => {
  it("accepts only the token bound to that session", () => {
    const t = csrfTokenFor("s".repeat(32), "sess-a");
    expect(verifyCsrf("s".repeat(32), "sess-a", t)).toBe(true);
    expect(verifyCsrf("s".repeat(32), "sess-b", t)).toBe(false);
    expect(verifyCsrf("s".repeat(32), "sess-a", null)).toBe(false);
    expect(verifyCsrf("s".repeat(32), "sess-a", t + "x")).toBe(false);
  });
});

describe("idempotency helpers", () => {
  it("scopes keys per user and operation", () => {
    const k = "c".repeat(24);
    expect(scopedIdempotencyKey("u1", "Receipt", k)).not.toBe(scopedIdempotencyKey("u2", "Receipt", k));
    expect(scopedIdempotencyKey("u1", "Receipt", k)).not.toBe(scopedIdempotencyKey("u1", "Pick", k));
    expect(scopedIdempotencyKey("u1", "Receipt", k)).toBe(scopedIdempotencyKey("u1", "Receipt", k));
  });
  it("validates key shape and fingerprints payloads independent of key order", () => {
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("a".repeat(32))).toBe(true);
    expect(payloadFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 2 }));
  });
});

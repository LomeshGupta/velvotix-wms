import { beforeEach, describe, expect, it } from "vitest";
import { BcGateway } from "@/lib/business-central/client";
import { parseConfig } from "@/lib/business-central/config";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { MockBc } from "@/lib/business-central/mock-bc";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";
import { BcSessionStore } from "@/lib/security/bc-session-store";
import { BcUserDirectory } from "@/lib/security/bc-user-directory";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { hashToken, newSessionToken, validateSession } from "@/lib/security/session";

const cfg = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "test", WMS_SESSION_SECRET: "x".repeat(32), WMS_BC_RATE_PER_SECOND: "1000", WMS_BC_MAX_CONCURRENT: "8", WMS_BC_MAX_READS: "8", WMS_BC_MAX_WRITES: "8" });

let mock: MockBc;
let coord: LocalCoordinator;
let gw: BcGateway;
let dir: BcUserDirectory;
let store: BcSessionStore;
let hash: string;

beforeEach(async () => {
  mock = new MockBc();
  coord = new LocalCoordinator();
  gw = new BcGateway({ cfg, coordinator: coord, scheduler: new RequestScheduler(cfg.scheduler, coord), tokens: { getToken: async () => "t", invalidate: () => undefined }, mock });
  dir = new BcUserDirectory(gw, coord);
  store = new BcSessionStore(gw, coord);
  hash ||= await hashPassword("a-long-test-password");
  mock.seedUser({ userId: "jane", displayName: "Jane Picker", passwordHash: hash, warehouses: ["main"], permissions: ["Transactions:Submit", "items:view"] });
});

describe("BC-backed user directory", () => {
  it("verifies a password inside the BC authentication action without exposing credential fields", async () => {
    const u = await dir.authenticate("jane", "a-long-test-password");
    expect(u?.userId).toBe("JANE");
    expect(u?.permissions).toEqual(["transactions:submit", "items:view"]);
    expect(u?.warehouseCodes).toEqual(["MAIN"]);
    expect(u).not.toHaveProperty("passwordHash");
    expect(u).not.toHaveProperty("passwordSalt");
    expect(mock.seenPaths).toContain("/v2.0/00000000-0000-0000-0000-000000000000/mock/ODataV4/VWMSAuth_Login");
  });
  it("merges enabled role-template permissions assigned in Business Central", async () => {
    mock.seedRole("PICKER", "Warehouse Picker", ["transactions:view", "warehouse:scan"]);
    mock.assignRole("jane", "picker");
    const u = await dir.authenticate("jane", "a-long-test-password");
    expect(u?.permissions).toContain("transactions:view");
    expect(u?.permissions).toContain("warehouse:scan");
    expect(u?.permissions.filter((p) => p === "items:view")).toHaveLength(1);
    expect(u?.roles).toContain("Warehouse Picker");
  });
  it("does not apply permissions from a disabled BC role", async () => {
    mock.seedRole("AUDITOR", "Warehouse Auditor", ["transactions:view"], false);
    mock.assignRole("jane", "AUDITOR");
    expect((await dir.authenticate("jane", "a-long-test-password"))?.permissions).not.toContain("transactions:view");
  });
  it("returns undefined for unknown users or incorrect passwords", async () => {
    expect(await dir.authenticate("nobody", "not-a-password" )).toBeUndefined();
    expect(await dir.authenticate("jane", "wrong-password" )).toBeUndefined();
  });
  it("profiles and cached records carry no credential material", async () => {
    const p = await dir.findProfile("jane");
    expect(JSON.stringify(p)).not.toContain("argon2");
    expect(p).not.toHaveProperty("passwordHash");
    const before = mock.requestCount;
    await dir.findProfile("jane");
    expect(mock.requestCount).toBe(before);
    const cached = await coord.cacheGet("prof:JANE");
    expect(cached).not.toBeNull();
    expect(cached).not.toContain("argon2");
  });
  it("locks account after repeated invalid passwords and refuses a subsequent correct login", async () => {
    for (let i = 0; i < 5; i++) await dir.authenticate("jane", "wrong-password");
    expect(await dir.authenticate("jane", "a-long-test-password")).toBeUndefined();
  });
  it("shows a suspended user as not Active", async () => {
    mock.seedUser({ userId: "sam", status: "Suspended", passwordHash: hash });
    expect((await dir.findProfile("sam"))?.status).toBe("Suspended");
  });
});

describe("BC-backed session store", () => {
  const policy = { idleMs: 30 * 60_000, absoluteMs: 12 * 3_600_000 };
  const make = async () => {
    const token = newSessionToken();
    const now = Date.now();
    await store.create({ idHash: hashToken(token), userId: "JANE", createdAt: now, lastSeenAt: now, ipHash: "ip", userAgent: "ua", revoked: false });
    return token;
  };

  it("creates sessions that validate by token (hash compared case-insensitively)", async () => {
    const token = await make();
    const check = await validateSession(store, token, policy);
    expect(check.ok).toBe(true);
    expect(await validateSession(store, "forged-token", policy)).toEqual({ ok: false, reason: "missing" });
  });
  it("serves repeated validations from cache (no BC call per request)", async () => {
    const token = await make();
    await validateSession(store, token, policy);
    const before = mock.requestCount;
    for (let i = 0; i < 20; i++) await validateSession(store, token, policy);
    expect(mock.requestCount).toBe(before);
  });
  it("revocation is immediate on the serving instance and persisted in BC", async () => {
    const token = await make();
    await validateSession(store, token, policy);
    await store.revoke(hashToken(token));
    expect(await validateSession(store, token, policy)).toEqual({ ok: false, reason: "revoked" });
    // A different instance (fresh cache) reads the persisted revocation from BC.
    const other = new BcSessionStore(gw, new LocalCoordinator());
    expect(await validateSession(other, token, policy)).toEqual({ ok: false, reason: "revoked" });
  });
  it("touch updates last-seen and lists only live sessions per user", async () => {
    const a = await make();
    const b = await make();
    await store.touch(hashToken(a), Date.now() + 1000);
    await store.revoke(hashToken(b));
    const live = await store.listForUser("JANE");
    expect(live.length).toBe(1);
    expect(live[0]?.idHash).toBe(hashToken(a));
  });
});

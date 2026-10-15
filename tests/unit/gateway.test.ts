import { beforeEach, describe, expect, it } from "vitest";
import { ResponseCache } from "@/lib/business-central/cache";
import { BcGateway } from "@/lib/business-central/client";
import { parseConfig } from "@/lib/business-central/config";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { MockBc } from "@/lib/business-central/mock-bc";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";
import type { Principal } from "@/types/principal";

const cfg = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "test", WMS_SESSION_SECRET: "x".repeat(32), WMS_BC_REQUEST_TIMEOUT_MS: "3000" });
const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: "u1", displayName: "U", sessionId: "s",
  permissions: ["items:view", "locations:view", "transactions:view", "transactions:submit"],
  warehouseCodes: ["MAIN"], ...over,
});

let mock: MockBc;
let gw: BcGateway;
beforeEach(() => {
  mock = new MockBc();
  const coord = new LocalCoordinator();
  gw = new BcGateway({ cfg, coordinator: coord, scheduler: new RequestScheduler(cfg.scheduler, coord), tokens: { getToken: async () => "t", invalidate: () => undefined }, mock });
});

describe("gateway allowlist and authorization", () => {
  it("rejects operations that are not in the registry", async () => {
    await expect(gw.read("../../etc/passwd", {}, { principal: principal() })).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
    await expect(gw.read("salesOrders.list", {}, { principal: principal() })).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
  });
  it("rejects a method/operation mismatch (cannot POST a read operation)", async () => {
    await expect(gw.submit("items.list", { idempotencyKey: "k".repeat(20) }, { principal: principal() })).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
  });
  it("enforces permissions from the server-side principal", async () => {
    await expect(gw.read("items.list", {}, { principal: principal({ permissions: [] }) })).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
  });
  it("rejects invalid structured queries before any BC call", async () => {
    await expect(gw.read("items.list", { top: 5000 }, { principal: principal() })).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(mock.requestCount).toBe(0);
  });
});

describe("gateway reads: cache, dedupe, retry", () => {
  it("returns only the selected fields even if BC returns more", async () => {
    const r = await gw.read("items.list", { select: ["number", "displayName"], top: 3 }, { principal: principal() });
    expect(Object.keys(r.rows[0] ?? {}).sort()).toEqual(["displayName", "number"]);
  });
  it("serves repeated identical reads from cache with one BC call", async () => {
    const ctx = { principal: principal() };
    const a = await gw.read("items.list", { top: 5 }, ctx);
    const b = await gw.read("items.list", { top: 5 }, ctx);
    expect(a.meta.source).toBe("miss");
    expect(b.meta.source).toBe("hit");
    expect(mock.requestCount).toBe(1);
  });
  it("collapses 30 concurrent identical reads into one BC call", async () => {
    const ctx = { principal: principal() };
    const rs = await Promise.all(Array.from({ length: 30 }, () => gw.read("items.list", { top: 7 }, ctx)));
    expect(rs.every((r) => r.rows.length > 0)).toBe(true);
    expect(mock.requestCount).toBe(1);
  });
  it("retries a transient 503 on a read and then succeeds", async () => {
    mock.failNext = { status: 503, times: 1 };
    const r = await gw.read("locations.list", {}, { principal: principal() });
    expect(r.rows.length).toBe(2);
    expect(mock.requestCount).toBe(2);
  });
  it("does not retry non-transient errors", async () => {
    mock.failNext = { status: 403, times: 5 };
    await expect(gw.read("locations.list", {}, { principal: principal() })).rejects.toMatchObject({ code: "BC_FORBIDDEN" });
    expect(mock.requestCount).toBe(1);
  });
  it("never returns raw BC error text to callers", async () => {
    mock.failNext = { status: 500, times: 9 };
    const e = await gw.read("locations.list", {}, { principal: principal() }).catch((x) => x);
    expect(String(e.message)).not.toMatch(/\{|stack|SQL/i);
  });
});

describe("gateway writes: idempotency and lost-response reconciliation", () => {
  const body = (key: string) => ({ idempotencyKey: key, operationType: "Receipt", locationCode: "MAIN", wmsUserId: "u1" });
  const key = "a".repeat(32);

  it("submits once and reports the staged record", async () => {
    const r = await gw.submit("transactions.submit", body(key), { principal: principal() });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("Submitted");
  });
  it("does NOT blindly retry a write when the response is lost; surfaces OUTCOME_UNKNOWN", async () => {
    mock.dropResponseOnce = true;
    await expect(gw.submit("transactions.submit", body(key), { principal: principal() })).rejects.toMatchObject({ code: "NETWORK", opts: { outcomeUnknown: true } });
    expect(mock.requestCount).toBe(1);
  });
  it("reconciles a lost response by idempotency key, and a resubmit does not duplicate", async () => {
    mock.dropResponseOnce = true;
    await gw.submit("transactions.submit", body(key), { principal: principal() }).catch(() => undefined);
    const found = await gw.findByIdempotencyKey<{ id: string; status: string }>(key, { principal: principal() });
    expect(found?.status).toBe("Submitted");
    const again = await gw.submit("transactions.submit", body(key), { principal: principal() });
    expect(again.status).toBe(200); // BC returns the existing record
    const all = await gw.read("transactions.list", {}, { principal: principal() });
    expect(all.rows.length).toBe(1);
  });
  it("treats 503 on a write as an unknown outcome and does not retry it", async () => {
    mock.failNext = { status: 503, times: 5 };
    await expect(gw.submit("transactions.submit", body(key), { principal: principal() })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(mock.requestCount).toBe(1);
  });
  it("requires an idempotency key on every write", async () => {
    await expect(gw.submit("transactions.submit", { operationType: "Receipt" }, { principal: principal() })).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
  it("returns the committed transaction on the next read (uncached by design)", async () => {
    const ctx = { principal: principal() };
    await gw.submit("transactions.submit", body("b".repeat(32)), ctx);
    expect((await gw.read("transactions.list", {}, ctx)).rows.length).toBe(1);
  });
});

describe("response cache invalidation", () => {
  it("serves from cache until a tag is bumped, then reloads; other tags are unaffected", async () => {
    const cache = new ResponseCache(new LocalCoordinator());
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad("op", "q", ["items"], 60_000, load);
    expect((await cache.getOrLoad("op", "q", ["items"], 60_000, load)).source).toBe("hit");
    await cache.invalidate(["locations"]);
    expect((await cache.getOrLoad("op", "q", ["items"], 60_000, load)).source).toBe("hit");
    await cache.invalidate(["items"]);
    expect((await cache.getOrLoad("op", "q", ["items"], 60_000, load)).source).toBe("miss");
    expect(loads).toBe(2);
  });
  it("keeps different query scopes in separate entries", async () => {
    const cache = new ResponseCache(new LocalCoordinator());
    const a = await cache.getOrLoad("op", "scope=MAIN", ["t"], 60_000, async () => "MAIN-data");
    const b = await cache.getOrLoad("op", "scope=EAST", ["t"], 60_000, async () => "EAST-data");
    expect([a.value, b.value]).toEqual(["MAIN-data", "EAST-data"]);
  });
});

describe("live Business Central company resolution", () => {
  it("resolves a configured display name to the real companies API GUID before custom API calls", async () => {
    const companyId = "0bbed129-9a49-4cf5-a45a-27e9b2fbab50";
    const liveCfg = parseConfig({
      WMS_BC_MODE: "live", NODE_ENV: "development",
      BC_TENANT_ID: "3d410f00-0000-4000-8000-000000000001",
      BC_CLIENT_ID: "a141a0bf-1fd7-41a0-8e0c-8e48ecf56701",
      BC_CLIENT_SECRET: "test-secret", BC_COMPANY_ID: "Velvotix Sandbox",
      BC_COMPANY_NAME: "My Company", BC_ENV_NAME: "sandbox-IN",
      WMS_SESSION_SECRET: "x".repeat(32),
    });
    const calls: string[] = [];
    const coord = new LocalCoordinator();
    const gateway = new BcGateway({
      cfg: liveCfg,
      coordinator: coord,
      scheduler: new RequestScheduler(liveCfg.scheduler, coord),
      tokens: { getToken: async () => "mock-bearer", invalidate: () => undefined },
      transport: async (url) => {
        calls.push(url);
        if (url.includes("/api/v2.0/companies?")) {
          return new Response(JSON.stringify({ value: [{ id: companyId, name: "Velvotix Sandbox", displayName: "Velvotix Sandbox" }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ value: [{ number: "ITEM-001", displayName: "Sample Item" }] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const r = await gateway.read("items.list", { top: 1 }, { principal: principal() });
    expect(r.rows[0]?.number).toBe("ITEM-001");
    expect(liveCfg.companyId).toBe(companyId);
    expect(liveCfg.companyResolved).toBe(true);
    expect(calls[0]).toContain("/api/v2.0/companies?$select=id,name,displayName");
    expect(calls[1]).toContain(`/api/velvotix/wms/v1.0/companies(${companyId})/items`);
  });
});

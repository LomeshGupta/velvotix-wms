import { beforeEach, describe, expect, it } from "vitest";
import { BcGateway } from "@/lib/business-central/client";
import { parseConfig } from "@/lib/business-central/config";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { MockBc } from "@/lib/business-central/mock-bc";
import { decodeODataEnum, encodeODataEnum } from "@/lib/business-central/odata-enum";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";
import { OPERATIONS } from "@/lib/business-central/endpoints";
import { buildQuery } from "@/lib/validation/odata";
import { SYSTEM_PRINCIPAL, type Principal } from "@/types/principal";

const cfg = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "test", WMS_SESSION_SECRET: "x".repeat(32), WMS_BC_REQUEST_TIMEOUT_MS: "3000" });
const user = (over: Partial<Principal> = {}): Principal => ({
  userId: "u1", displayName: "U", sessionId: "s", warehouseCodes: ["MAIN"],
  permissions: ["transactions:view", "transactions:submit"], ...over,
});
let mock: MockBc;
let gw: BcGateway;
beforeEach(() => {
  mock = new MockBc();
  const coord = new LocalCoordinator();
  gw = new BcGateway({ cfg, coordinator: coord, scheduler: new RequestScheduler(cfg.scheduler, coord), tokens: { getToken: async () => "t", invalidate: () => undefined }, mock });
});
const ctx = { principal: user() };
const key = (c: string) => c.repeat(32);

describe("OData enum escaping", () => {
  it("round-trips labels with spaces and hyphens", () => {
    expect(encodeODataEnum("Requires Reconciliation")).toBe("Requires_x0020_Reconciliation");
    expect(encodeODataEnum("Put-away")).toBe("Put_x002D_away");
    expect(decodeODataEnum("Requires_x0020_Reconciliation")).toBe("Requires Reconciliation");
    expect(decodeODataEnum(encodeODataEnum("Cycle Count"))).toBe("Cycle Count");
  });
  it("filters enums by quoted, escaped literal and rejects unknown values", () => {
    const q = buildQuery(OPERATIONS["transactions.list"].query, { filter: [{ field: "status", op: "eq", value: "Requires Reconciliation" }] });
    expect(q.params.get("$filter")).toBe("(status eq 'Requires_x0020_Reconciliation')");
    expect(() => buildQuery(OPERATIONS["transactions.list"].query, { filter: [{ field: "status", op: "eq", value: "Hacked' or 1 eq 1" }] })).toThrow();
  });
  it("decodes enum fields in read results", async () => {
    await gw.create("transactions.submit", { idempotencyKey: key("a"), operationType: "Put-away", locationCode: "MAIN", wmsUserId: "u1" }, ctx);
    const r = await gw.read("transactions.list", { select: ["status", "operationType"] }, ctx);
    expect(r.rows[0]).toEqual({ status: "Submitted", operationType: "Put-away" });
  });
});

describe("duplicate submissions (real AL rejects the key; the gateway reconciles)", () => {
  const body = { idempotencyKey: key("b"), operationType: "Diagnostic", locationCode: "MAIN", wmsUserId: "u1" };
  it("returns the stored record flagged duplicate instead of failing or double-submitting", async () => {
    const first = await gw.create("transactions.submit", body, ctx);
    const second = await gw.create("transactions.submit", body, ctx);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);
    expect(mock.transactionRows().length).toBe(1);
  });
  it("copes with BC upper-casing Code fields (keys and location come back upper-case)", async () => {
    await gw.create("transactions.submit", { ...body, idempotencyKey: "abcdef0123456789abcdef", locationCode: "main" }, ctx);
    const found = await gw.findByIdempotencyKey<{ idempotencyKey: string }>("abcdef0123456789abcdef", ctx);
    expect(found?.idempotencyKey).toBe("ABCDEF0123456789ABCDEF");
  });
  it("reconciles after a lost response even if the caller holds only submit rights", async () => {
    mock.dropResponseOnce = true;
    const submitOnly = { principal: user({ permissions: ["transactions:submit"] }) };
    await expect(gw.create("transactions.submit", body, submitOnly)).rejects.toMatchObject({ code: "NETWORK" });
    const again = await gw.create("transactions.submit", body, submitOnly);
    expect(again.duplicate).toBe(true);
  });
  it("AL-side rejections (inactive user, wrong warehouse, missing permission) surface as safe errors", async () => {
    mock.enforceUsers = true;
    mock.seedUser({ userId: "u1", warehouses: ["MAIN"], permissions: ["transactions:submit"] });
    mock.seedUser({ userId: "u2", status: "Suspended", warehouses: ["MAIN"], permissions: ["transactions:submit"] });
    mock.seedUser({ userId: "u3", warehouses: ["EAST"], permissions: ["transactions:submit"] });
    mock.seedUser({ userId: "u4", warehouses: ["MAIN"], permissions: [] });
    await expect(gw.create("transactions.submit", { ...body, wmsUserId: "u1" }, ctx)).resolves.toMatchObject({ status: 201 });
    for (const [i, u] of ["u2", "u3", "u4"].entries()) {
      const e = await gw.create("transactions.submit", { ...body, idempotencyKey: key(String(i + 1)), wmsUserId: u }, ctx).catch((x) => x);
      expect(e.code).toBe("BC_BAD_REQUEST");
      expect(String(e.message)).not.toMatch(/not active|not assigned|permission transactions/);
    }
  });
});

describe("worker actions and patch", () => {
  it("rejects missing, extra and wrongly-typed action parameters before calling BC", async () => {
    const sys = { principal: SYSTEM_PRINCIPAL };
    await expect(gw.invoke("worker.claimBatch", { workerId: "w1" }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(gw.invoke("worker.claimBatch", { workerId: "w1", leaseSeconds: "60", maxCount: 1 }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(gw.invoke("worker.claimBatch", { workerId: "w1", leaseSeconds: 60, maxCount: 1, evil: 1 }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
    expect(mock.requestCount).toBe(0);
  });
  it("only the system principal may call worker internals; users cannot", async () => {
    await expect(gw.invoke("worker.claimBatch", { workerId: "w", leaseSeconds: 60, maxCount: 1 }, ctx)).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
    await expect(gw.read("authUsers.get", {}, ctx)).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
  });
  it("claim -> process runs a Diagnostic transaction to Completed through the real action contract", async () => {
    const sys = { principal: SYSTEM_PRINCIPAL };
    await gw.create("transactions.submit", { idempotencyKey: key("c"), operationType: "Diagnostic", locationCode: "MAIN", wmsUserId: "u1" }, ctx);
    const claimed = await gw.invoke<{ id: string }[]>("worker.claimBatch", { workerId: "w1", leaseSeconds: 60, maxCount: 5 }, sys);
    expect(claimed.length).toBe(1);
    const again = await gw.invoke<unknown[]>("worker.claimBatch", { workerId: "w2", leaseSeconds: 60, maxCount: 5 }, sys);
    expect(again.length).toBe(0);
    const out = await gw.invoke<{ outcome: string; status: string; resultDocumentNo: string }>("worker.process", { transactionId: claimed[0]!.id, workerId: "w1" }, sys);
    expect(out.outcome).toBe("processed");
    expect(out.status).toBe("Completed");
    expect(out.resultDocumentNo).toMatch(/^DIAG-/);
  });
  it("text-returning actions (cancel) return the AL text, not parsed JSON", async () => {
    const cancelUser = { principal: user({ permissions: ["transactions:cancel", "transactions:submit"] }) };
    const tx = await gw.create("transactions.submit", { idempotencyKey: key("d"), operationType: "Diagnostic", locationCode: "MAIN", wmsUserId: "u1" }, cancelUser);
    const out = await gw.invoke<string>("worker.cancel", { transactionId: String(tx.body.id), userId: "u1" }, cancelUser);
    expect(out).toBe("Cancelled");
  });
  it("patch allows null only on nullable fields", async () => {
    const sys = { principal: SYSTEM_PRINCIPAL };
    await expect(gw.patch("sessions.update", "11111111-1111-4111-8111-111111111101", { revokedBy: null }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
  it("patch accepts only declared fields and valid record ids", async () => {
    const sys = { principal: SYSTEM_PRINCIPAL };
    await expect(gw.patch("sessions.update", "not-a-guid", { revoked: true }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(gw.patch("sessions.update", "11111111-1111-4111-8111-111111111101", { userId: "x" }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
    await expect(gw.patch("sessions.update", "11111111-1111-4111-8111-111111111101", { revoked: "yes" }, sys)).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
});

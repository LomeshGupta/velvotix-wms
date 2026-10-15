import { beforeEach, describe, expect, it } from "vitest";
import { BcGateway } from "@/lib/business-central/client";
import { parseConfig } from "@/lib/business-central/config";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { MockBc } from "@/lib/business-central/mock-bc";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";
import { lookupItem, ReceiptInput, submitReceipt } from "@/features/receiving/service";
import type { Principal } from "@/types/principal";

const cfg = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "test", WMS_SESSION_SECRET: "x".repeat(32), WMS_BC_RATE_PER_SECOND: "1000" });
const user: Principal = { userId: "JANE", displayName: "Jane", sessionId: "s", warehouseCodes: ["MAIN"], permissions: ["transactions:submit", "items:view"] };
let mock: MockBc;
let gw: BcGateway;
beforeEach(() => {
  mock = new MockBc();
  const coord = new LocalCoordinator();
  gw = new BcGateway({ cfg, coordinator: coord, scheduler: new RequestScheduler(cfg.scheduler, coord), tokens: { getToken: async () => "t", invalidate: () => undefined }, mock });
});
const input = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  clientKey: "0b5f4c1e-3a52-4a52-9d8a-1f2f6d0e9a11", locationCode: "main", sourceDocumentNo: "PO-1001",
  lines: [{ itemNo: "1100", quantity: 12, lotNo: "L-7" }], ...over,
});

describe("receiving input validation", () => {
  it("rejects bad shapes before anything reaches BC", () => {
    expect(ReceiptInput.safeParse(input({ lines: [] })).success).toBe(false);
    expect(ReceiptInput.safeParse(input({ lines: [{ itemNo: "1100", quantity: 0 }] })).success).toBe(false);
    expect(ReceiptInput.safeParse(input({ lines: [{ itemNo: "1100'; DROP", quantity: 1 }] })).success).toBe(false);
    expect(ReceiptInput.safeParse(input({ clientKey: "not-a-uuid" })).success).toBe(false);
    expect(ReceiptInput.safeParse(input({ lines: Array.from({ length: 51 }, () => ({ itemNo: "1", quantity: 1 })) })).success).toBe(false);
  });
});

describe("submitReceipt", () => {
  it("stores a Submitted Receipt for the session user and location, with a scoped idempotency key", async () => {
    const r = await submitReceipt(gw, user, ReceiptInput.parse(input()), "corr-1");
    expect(r.status).toBe("Submitted");
    expect(r.duplicate).toBe(false);
    const row = mock.transactionRows()[0]!;
    expect(row.wmsUserId).toBe("JANE");
    expect(row.locationCode).toBe("MAIN");
    expect(String(row.idempotencyKey)).toHaveLength(64);
    expect(String(row.idempotencyKey)).not.toContain("0B5F4C1E"); // client key is never stored raw
  });
  it("refuses a location the session user is not assigned to, even if the browser asks for it", async () => {
    await expect(submitReceipt(gw, user, ReceiptInput.parse(input({ locationCode: "EAST" })), "c")).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
    expect(mock.requestCount).toBe(0);
  });
  it("a retry with the same key and contents returns the same transaction (no second receipt)", async () => {
    const a = await submitReceipt(gw, user, ReceiptInput.parse(input()), "c1");
    const b = await submitReceipt(gw, user, ReceiptInput.parse(input()), "c2");
    expect(b.duplicate).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);
    expect(mock.transactionRows().length).toBe(1);
  });
  it("the same key with different contents is a conflict, never merged", async () => {
    await submitReceipt(gw, user, ReceiptInput.parse(input()), "c1");
    const changed = ReceiptInput.parse(input({ lines: [{ itemNo: "1100", quantity: 99 }] }));
    await expect(submitReceipt(gw, user, changed, "c2")).rejects.toMatchObject({ code: "BC_CONFLICT" });
    expect(mock.transactionRows().length).toBe(1);
  });
  it("two different users using the same client key do not collide", async () => {
    await submitReceipt(gw, user, ReceiptInput.parse(input()), "c1");
    const other = { ...user, userId: "SAM" };
    const r = await submitReceipt(gw, other, ReceiptInput.parse(input()), "c2");
    expect(r.duplicate).toBe(false);
    expect(mock.transactionRows().length).toBe(2);
  });
  it("recovers cleanly when the response is lost after BC stored the receipt", async () => {
    mock.dropResponseOnce = true;
    await expect(submitReceipt(gw, user, ReceiptInput.parse(input()), "c1")).rejects.toMatchObject({ code: "NETWORK" });
    const retry = await submitReceipt(gw, user, ReceiptInput.parse(input()), "c2");
    expect(retry.duplicate).toBe(true);
    expect(mock.transactionRows().length).toBe(1);
  });
});

describe("status polling by id", () => {
  it("finds a stored transaction by its id with an unquoted GUID filter, scoped to the user's warehouse", async () => {
    const r = await submitReceipt(gw, user, ReceiptInput.parse(input()), "c1");
    const viewer: Principal = { ...user, permissions: [...user.permissions, "transactions:view"] };
    const hit = await gw.read<{ id: string; status: string }>("transactions.list", { select: ["id", "status"], filter: [{ field: "id", op: "eq", value: r.transactionId }], top: 1 }, { principal: viewer });
    expect(hit.rows[0]?.id).toBe(r.transactionId);
    const elsewhere: Principal = { ...viewer, warehouseCodes: ["EAST"] };
    const miss = await gw.read("transactions.list", { select: ["id"], filter: [{ field: "id", op: "eq", value: r.transactionId }], top: 1 }, { principal: elsewhere });
    expect(miss.rows.length).toBe(0);
  });
});

describe("lookupItem", () => {
  it("finds by item number, then by barcode, and returns undefined otherwise", async () => {
    expect((await lookupItem(gw, user, "1100", "c"))?.displayName).toBe("Front Wheel");
    expect((await lookupItem(gw, user, "5901234123457", "c"))?.number).toBe("1000");
    expect(await lookupItem(gw, user, "nope", "c")).toBeUndefined();
    expect(await lookupItem(gw, user, "x".repeat(60), "c")).toBeUndefined();
  });
  it("treats injection attempts as plain data", async () => {
    expect(await lookupItem(gw, user, "1100' or 'a' eq 'a", "c")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { BcGateway } from "@/lib/business-central/client";
import { parseConfig } from "@/lib/business-central/config";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { MockBc } from "@/lib/business-central/mock-bc";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";
import { BcStagingRepository, mapProcessResult } from "@/lib/queue/bc-staging-repository";
import { Worker, type ProcessOutcome, type StagedTransaction, type StagingRepository } from "@/lib/queue/worker";
import type { Principal } from "@/types/principal";

const cfg = parseConfig({ WMS_BC_MODE: "mock", NODE_ENV: "test", WMS_SESSION_SECRET: "x".repeat(32), WMS_BC_MAX_CONCURRENT: "8", WMS_BC_MAX_READS: "8", WMS_BC_MAX_WRITES: "8", WMS_BC_MAX_BACKGROUND: "8", WMS_BC_RATE_PER_SECOND: "1000" });
const user: Principal = { userId: "u1", displayName: "U", sessionId: "s", warehouseCodes: ["MAIN"], permissions: ["transactions:view", "transactions:submit"] };

function stack() {
  const mock = new MockBc();
  const coord = new LocalCoordinator();
  const gw = new BcGateway({ cfg, coordinator: coord, scheduler: new RequestScheduler(cfg.scheduler, coord), tokens: { getToken: async () => "t", invalidate: () => undefined }, mock });
  return { mock, gw };
}
const submit = (gw: BcGateway, n: number, op = "Diagnostic") =>
  gw.create("transactions.submit", { idempotencyKey: `tx-${op}-${n}`.padEnd(20, "0"), operationType: op, locationCode: "MAIN", wmsUserId: "u1" }, { principal: user });
const opts = (id: string) => ({ workerId: id, concurrency: 3, pollIntervalMs: 5, leaseMs: 5000 });
const runFor = async (workers: Worker[], ms: number) => {
  const ps = workers.map((w) => w.run());
  await new Promise((r) => setTimeout(r, ms));
  workers.forEach((w) => w.stop());
  await Promise.all(ps);
};
const statuses = (mock: MockBc) => mock.transactionRows().map((r) => String(r.status));

describe("worker against the BC contract (mock BC)", () => {
  it("runs Diagnostic transactions to Completed and fails unimplemented operations visibly", async () => {
    const { mock, gw } = stack();
    for (let i = 0; i < 3; i++) await submit(gw, i);
    await submit(gw, 9, "Receipt");
    await runFor([new Worker(new BcStagingRepository(gw, "w1", 60), opts("w1"))], 250);
    const rows = mock.transactionRows();
    expect(rows.filter((r) => r.status === "Completed").length).toBe(3);
    const receipt = rows.find((r) => String(r.operationType) === "Receipt");
    expect(receipt?.status).toBe("Failed");
    expect(receipt?.errorCode).toBe("OPERATION_NOT_IMPLEMENTED");
  });

  it("two workers share 12 transactions with no double processing", async () => {
    const { mock, gw } = stack();
    for (let i = 0; i < 12; i++) await submit(gw, i);
    await runFor([
      new Worker(new BcStagingRepository(gw, "w1", 60), opts("w1")),
      new Worker(new BcStagingRepository(gw, "w2", 60), opts("w2")),
    ], 400);
    const rows = mock.transactionRows();
    expect(rows.every((r) => r.status === "Completed")).toBe(true);
    expect(rows.every((r) => r.attemptCount === 1)).toBe(true);
  });

  it("a transient failure is requeued by AL and later completes on a second attempt", async () => {
    const { mock, gw } = stack();
    let calls = 0;
    mock.processOutcome = () => (++calls === 1 ? "transient" : "complete");
    await submit(gw, 1);
    await runFor([new Worker(new BcStagingRepository(gw, "w1", 60), opts("w1"))], 300);
    const row = mock.transactionRows()[0]!;
    expect(row.status).toBe("Completed");
    expect(row.attemptCount).toBe(2);
  });
});

describe("worker loop behaviour (fake repository)", () => {
  class Fake implements StagingRepository {
    processed: string[] = [];
    constructor(public queue: StagedTransaction[], public fn: (id: string) => Promise<ProcessOutcome>) {}
    async claimBatch(limit: number) { return this.queue.splice(0, limit); }
    async process(id: string) { this.processed.push(id); return this.fn(id); }
    async heartbeat() { return true; }
  }
  const tx = (id: string): StagedTransaction => ({ id, operationType: "Receipt", attemptCount: 1 });

  it("never retries from the worker when the result of process() is unknown", async () => {
    const events: string[] = [];
    const repo = new Fake([tx("a")], async () => { throw new Error("socket hang up"); });
    await runFor([new Worker(repo, { ...opts("w"), onEvent: (e) => events.push(e) })], 120);
    expect(repo.processed).toEqual(["a"]);
    expect(events).toContain("process_result_unknown");
  });

  it("drains in-flight work on graceful stop", async () => {
    const repo = new Fake([tx("a")], async () => { await new Promise((r) => setTimeout(r, 40)); return { kind: "completed" }; });
    const w = new Worker(repo, opts("w"));
    const p = w.run();
    await new Promise((r) => setTimeout(r, 20));
    w.stop();
    await p;
    expect(repo.processed).toEqual(["a"]);
  });

  it("keeps polling after a claim error instead of dying", async () => {
    let n = 0;
    const repo: StagingRepository = {
      claimBatch: async () => { if (++n === 1) throw new Error("boom"); return n === 2 ? [tx("a")] : []; },
      process: async () => ({ kind: "completed" }),
      heartbeat: async () => true,
    };
    const events: string[] = [];
    await runFor([new Worker(repo, { ...opts("w"), onEvent: (e) => events.push(e) })], 150);
    expect(events).toContain("poll_error");
    expect(events).toContain("processed");
  });
});

describe("mapping AL results (AL is authoritative)", () => {
  const base = { id: "11111111-1111-4111-8111-111111111101", errorCode: "", resultDocumentNo: "" };
  it("maps each AL status", () => {
    expect(mapProcessResult({ ...base, outcome: "processed", status: "Completed", resultDocumentNo: "DIAG-1" })).toEqual({ kind: "completed", resultDocumentNo: "DIAG-1" });
    expect(mapProcessResult({ ...base, outcome: "processed", status: "Queued", errorCode: "TRANSIENT_ERROR" }).kind).toBe("retry_scheduled");
    expect(mapProcessResult({ ...base, outcome: "processed", status: "Failed", errorCode: "X" }).kind).toBe("failed");
    expect(mapProcessResult({ ...base, outcome: "not_owner", status: "Processing" }).kind).toBe("lease_lost");
  });
  it("never reports success for an unexpected status", () => {
    expect(mapProcessResult({ ...base, outcome: "processed", status: "Partially Completed" }).kind).toBe("requires_reconciliation");
  });
  it("rejects malformed responses instead of guessing", () => {
    expect(() => mapProcessResult({ nope: true })).toThrow();
  });
});

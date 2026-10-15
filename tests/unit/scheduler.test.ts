import { describe, expect, it } from "vitest";
import { LocalCoordinator } from "@/lib/business-central/coordinator";
import { GatewayError } from "@/lib/business-central/errors";
import { RequestScheduler } from "@/lib/business-central/request-scheduler";

const base = {
  maxConcurrent: 2, maxReads: 2, maxWrites: 1, maxBackground: 1,
  maxQueueInteractive: 3, maxQueueWrite: 3, maxQueueBackground: 3,
  ratePerSecond: 1000, requestTimeoutMs: 2000, maxRetries: 2, userRatePerMinute: 6000, instanceCount: 1,
};
const mk = (over: Partial<typeof base> = {}) => new RequestScheduler({ ...base, ...over }, new LocalCoordinator());
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

describe("request scheduler", () => {
  it("never exceeds the global concurrency cap", async () => {
    const s = mk({ maxQueueInteractive: 50 }); let cur = 0, max = 0;
    const task = async () => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 15)); cur--; };
    await Promise.all(Array.from({ length: 8 }, () => s.run("interactive", { operation: "t" }, task)));
    expect(max).toBeLessThanOrEqual(2);
  });
  it("rejects with QUEUE_FULL (retryable) when the bounded queue is full", async () => {
    const s = mk({ maxConcurrent: 1, maxReads: 1, maxQueueInteractive: 2 });
    const g = gate();
    const held = Array.from({ length: 3 }, () => s.run("interactive", { operation: "t" }, () => g.p));
    await new Promise((r) => setTimeout(r, 10));
    const err = await s.run("interactive", { operation: "t" }, async () => 1).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("QUEUE_FULL");
    expect(err.retryable).toBe(true);
    g.open(); await Promise.all(held);
  });
  it("serves interactive work before queued background work", async () => {
    const s = mk({ maxConcurrent: 1, maxReads: 1, maxBackground: 1 });
    const g = gate(); const order: string[] = [];
    const first = s.run("interactive", { operation: "t" }, () => g.p);
    await new Promise((r) => setTimeout(r, 5));
    const bg = s.run("background", { operation: "t" }, async () => { order.push("bg"); });
    const fg = s.run("interactive", { operation: "t" }, async () => { order.push("fg"); });
    g.open(); await Promise.all([first, bg, fg]);
    expect(order).toEqual(["fg", "bg"]);
  });
  it("divides budgets by instance count so a fleet stays near the global budget", async () => {
    const s = mk({ maxConcurrent: 4, maxReads: 4, instanceCount: 4, maxQueueInteractive: 50 });
    let cur = 0, max = 0;
    await Promise.all(Array.from({ length: 6 }, () => s.run("interactive", { operation: "t" }, async () => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 10)); cur--; })));
    expect(max).toBe(1);
  });
  it("opens the breaker after repeated failures, then probes once after cooldown", async () => {
    let now = 0;
    const s = new RequestScheduler({ ...base }, new LocalCoordinator(), () => now, 3, 1000);
    for (let i = 0; i < 3; i++) await s.run("interactive", { operation: "t" }, async () => { s.reportOutcome(false); });
    await expect(s.run("interactive", { operation: "t" }, async () => 1)).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    now = 1500;
    await s.run("interactive", { operation: "t" }, async () => { s.reportOutcome(true); });
    expect(s.snapshot().breaker).toBe("closed");
  });
  it("rate-limits an individual user without affecting others", async () => {
    const s = mk({ userRatePerMinute: 60 }); // burst = max(10, 10) = 10
    for (let i = 0; i < 10; i++) await s.run("interactive", { operation: "t", userId: "a" }, async () => 1);
    await expect(s.run("interactive", { operation: "t", userId: "a" }, async () => 1)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(s.run("interactive", { operation: "t", userId: "b" }, async () => 1)).resolves.toBe(1);
  });
});

import "server-only";
import { getConfig } from "./config";
import type { BcGateway } from "./client";
import type { MockBc } from "./mock-bc";
import { encodeODataEnum } from "./odata-enum";
import { BcStagingRepository } from "@/lib/queue/bc-staging-repository";
import { Worker } from "@/lib/queue/worker";

/**
 * MOCK MODE ONLY. In mock mode Business Central lives inside the Next.js process, so a separate
 * worker process cannot see it. This runs the same Worker + BcStagingRepository in-process so the
 * UI can be exercised end to end. It also simulates the AL handlers that do not exist yet: the
 * receiving-related operations complete, the rest fail exactly as the real AL default does.
 * It never runs in live mode (config forbids mock in production).
 */
const g = globalThis as unknown as { __wmsDevWorker?: Worker };

export function startDevWorker(gateway: BcGateway, mock: MockBc): void {
  if (getConfig().mode !== "mock" || g.__wmsDevWorker) return;
  // The mock worker exercises the end-to-end WMS queue contract for every supported workflow.
  // This is deliberately a simulation only: the live AL handler set is independently validated.
  const simulated = new Set([
    "Diagnostic", "Receipt", "Put-away", "Movement", "Pick", "Pack", "Ship",
    "Cycle Count", "Adjustment", "Return", "Quality Inspection",
  ].map(encodeODataEnum));
  mock.processOutcome = (row) => (simulated.has(String(row.operationType)) ? "complete" : "permanent");
  const worker = new Worker(new BcStagingRepository(gateway, "DEV-WORKER", 60), {
    workerId: "DEV-WORKER", concurrency: 2, pollIntervalMs: 700, leaseMs: 60_000,
  });
  g.__wmsDevWorker = worker;
  void worker.run();
}

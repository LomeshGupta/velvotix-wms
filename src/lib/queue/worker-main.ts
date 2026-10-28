import "server-only";
import { hostname } from "node:os";
import { getGateway, getScheduler } from "@/lib/business-central/client";
import { ConfigError, getConfig } from "@/lib/business-central/config";
import { logger } from "@/lib/telemetry/logger";
import { BcStagingRepository } from "./bc-staging-repository";
import { Worker } from "./worker";

/**
 * Long-running worker process (run separately from the Next.js web tier; serverless functions
 * cannot host it). Start with `npm run worker`. Business Central staging is the queue, so any
 * number of workers may run; AL's lease-based claim guarantees a row is processed by one of them.
 *
 * Throughput note: worker calls use the scheduler's "background" lane. Raise WMS_BC_MAX_BACKGROUND
 * (within your measured BC budget) to process transactions in parallel.
 */
const intEnv = (name: string, def: number, min: number, max: number): number => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v >= min && v <= max ? v : def;
};

async function main(): Promise<void> {
  const cfg = getConfig();
  if (cfg.mode === "mock") {
    logger.warn("worker.mock_mode", { note: "Mock BC is in-process only; this worker will see no transactions." });
  }
  const workerId = (process.env.WMS_WORKER_ID ?? `${hostname()}-${process.pid}`).slice(0, 50);
  const leaseSeconds = intEnv("WMS_WORKER_LEASE_SECONDS", 120, 15, 3600);
  const repo = new BcStagingRepository(getGateway(), workerId, leaseSeconds);
  const worker = new Worker(repo, {
    workerId,
    concurrency: intEnv("WMS_WORKER_CONCURRENCY", 3, 1, 20),
    pollIntervalMs: intEnv("WMS_WORKER_POLL_MS", 2000, 100, 60_000),
    leaseMs: leaseSeconds * 1000,
    onEvent: (event, data) => logger.info(`worker.${event}`, { workerId, ...data }),
  });

  const beat = setInterval(() => {
    logger.info("worker.heartbeat", { workerId, lastLoopAt: new Date(worker.heartbeatAt).toISOString(), scheduler: getScheduler().snapshot() });
  }, 30_000);

  const shutdown = (signal: string) => {
    logger.info("worker.shutdown", { workerId, signal });
    worker.stop();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("worker.start", { workerId, leaseSeconds });
  await worker.run(); // resolves after in-flight work drains
  clearInterval(beat);
  logger.info("worker.stopped", { workerId });
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    if (e instanceof ConfigError) console.error(e.message);
    else logger.error("worker.fatal", { errorCode: e instanceof Error ? e.name : "unknown" });
    process.exit(1);
  },
);

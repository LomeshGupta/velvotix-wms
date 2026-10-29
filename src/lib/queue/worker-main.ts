import "server-only";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

/**
 * Standalone worker entry point.
 * Unlike `next start`, running this file through `tsx` does not automatically
 * load the Next.js environment files. Load them before importing application
 * modules, because those modules may initialize configuration at import time.
 */
const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// Respect NODE_ENV if the process manager supplied it. If it is unset, use
// production-style env-file selection, matching `next start`, without trying
// to assign to process.env.NODE_ENV (which can be read-only in this project).
const isDevelopment = process.env.NODE_ENV === "development";
const { loadedEnvFiles } = loadEnvConfig(projectRoot, isDevelopment);

console.info("[WMS Worker] Environment initialized", {
  projectRoot,
  nodeEnv: process.env.NODE_ENV ?? "(unset)",
  mode: process.env.WMS_BC_MODE ?? "(unset)",
  loadedEnvFiles: loadedEnvFiles.map((file) => file.path),
});

const intEnv = (
  name: string,
  def: number,
  min: number,
  max: number,
): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : def;
};

async function main(): Promise<void> {
  // IMPORTANT: keep these runtime imports below loadEnvConfig().
  const [
    { getGateway, getScheduler },
    { ConfigError, getConfig },
    { logger },
    { BcStagingRepository },
    { Worker },
  ] = await Promise.all([
    import("@/lib/business-central/client"),
    import("@/lib/business-central/config"),
    import("@/lib/telemetry/logger"),
    import("./bc-staging-repository"),
    import("./worker"),
  ]);

  const cfg = getConfig();

  if (cfg.mode === "mock") {
    throw new ConfigError([
      "The standalone WMS worker resolved WMS_BC_MODE=mock.",
      `Project root: ${projectRoot}`,
      `Environment files loaded: ${loadedEnvFiles.map((file) => file.path).join(", ") || "none"}`,
      "Ensure WMS_BC_MODE=live is set in the effective environment and is not overridden by the process manager.",
    ]);
  }

  const workerId = (
    process.env.WMS_WORKER_ID ?? `${hostname()}-${process.pid}`
  ).slice(0, 50);
  const leaseSeconds = intEnv("WMS_WORKER_LEASE_SECONDS", 120, 15, 3600);
  const repo = new BcStagingRepository(getGateway(), workerId, leaseSeconds);
  const worker = new Worker(repo, {
    workerId,
    concurrency: intEnv("WMS_WORKER_CONCURRENCY", 3, 1, 20),
    pollIntervalMs: intEnv("WMS_WORKER_POLL_MS", 2000, 100, 60_000),
    leaseMs: leaseSeconds * 1000,
    onEvent: (event, data) =>
      logger.info(`worker.${event}`, { workerId, ...data }),
  });

  const beat = setInterval(() => {
    logger.info("worker.heartbeat", {
      workerId,
      lastLoopAt: new Date(worker.heartbeatAt).toISOString(),
      scheduler: getScheduler().snapshot(),
    });
  }, 30_000);

  const shutdown = (signal: string): void => {
    logger.info("worker.shutdown", { workerId, signal });
    worker.stop();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("worker.start", { workerId, leaseSeconds, mode: cfg.mode });
  try {
    await worker.run(); // resolves after in-flight work drains
  } finally {
    clearInterval(beat);
  }
  logger.info("worker.stopped", { workerId });
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // Load the logger/config modules in main, so startup failures before those
    // imports are handled with console output by the promise rejection handler.
    console.error(
      "[WMS Worker] Fatal startup/runtime error:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  },
);

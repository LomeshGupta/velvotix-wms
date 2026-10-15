import { NextResponse } from "next/server";
import { getScheduler } from "@/lib/business-central/client";
import { getConfig } from "@/lib/business-central/config";
import { getCoordinator } from "@/lib/business-central/coordinator";
import { protectedRoute } from "@/lib/security/route";
import { metrics } from "@/lib/telemetry/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Integration health for administrators. Per-instance view; no secrets, no raw error text. */
export const GET = protectedRoute({ permission: "administration:administer" }, async () => {
  const cfg = getConfig();
  const redisConfigured = Boolean(cfg.redisUrl);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    mode: cfg.mode,
    environment: cfg.envName,
    redis: redisConfigured ? ((await getCoordinator(cfg.redisUrl).ping()) ? "up" : "down") : "not configured",
    scheduler: getScheduler().snapshot(),
    limits: { maxConcurrent: cfg.scheduler.maxConcurrent, maxReads: cfg.scheduler.maxReads, maxWrites: cfg.scheduler.maxWrites, maxBackground: cfg.scheduler.maxBackground, ratePerSecond: cfg.scheduler.ratePerSecond, instanceCount: cfg.scheduler.instanceCount },
    metrics: metrics.snapshot(),
  });
});

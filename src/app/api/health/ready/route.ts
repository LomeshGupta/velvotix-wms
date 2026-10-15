import { ConfigError, getConfig } from "@/lib/business-central/config";
import { getCoordinator } from "@/lib/business-central/coordinator";
import { getScheduler } from "@/lib/business-central/client";
import { metrics } from "@/lib/telemetry/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness: configuration valid, Redis reachable when configured, breaker not open.
 * Returns no secrets and no raw error text. It does not call BC on every probe;
 * BC health is inferred from recent real traffic (see lastSuccessAt).
 */
export async function GET(): Promise<Response> {
  try {
    const cfg = getConfig();
    const redisConfigured = Boolean(cfg.redisUrl);
    const redisOk = redisConfigured ? await getCoordinator(cfg.redisUrl).ping() : null;
    const sched = getScheduler().snapshot();
    const ready = sched.breaker !== "open";
    return Response.json(
      {
        status: ready ? "ready" : "degraded",
        mode: cfg.mode,
        redis: redisConfigured ? (redisOk ? "up" : "down (running on local limits)") : "not configured",
        breaker: sched.breaker,
        queued: sched.queued,
        oldestQueuedMs: sched.oldestQueuedMs,
        lastBcSuccessAt: metrics.snapshot().lastSuccessAt ?? null,
      },
      { status: ready ? 200 : 503 },
    );
  } catch (e) {
    if (e instanceof ConfigError) return Response.json({ status: "misconfigured", issues: e.issues }, { status: 503 });
    return Response.json({ status: "error" }, { status: 503 });
  }
}

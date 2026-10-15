import "server-only";
import type { WmsConfig } from "./config";
import type { Coordinator } from "./coordinator";
import { GatewayError } from "./errors";
import { sleep } from "./retry-policy";
import type { Lane } from "./endpoints";

type SchedulerConfig = WmsConfig["scheduler"];

export interface TaskContext {
  queueWaitMs: number;
}

export interface RunMeta {
  operation: string;
  userId?: string;
}

interface Waiter {
  lane: Lane;
  meta: RunMeta;
  enqueuedAt: number;
  start: (queueWaitMs: number) => void;
  fail: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const LANE_ORDER: readonly Lane[] = ["interactive", "write", "background"];
/** After this many consecutive higher-priority dispatches, a waiting lower lane gets a turn. */
const STARVATION_LIMIT = 8;

export type BreakerState = "closed" | "open" | "half-open";

/**
 * All BC traffic passes through here. Bounded queues, three lanes with their
 * own budgets, priority with starvation protection, a distributed rate token
 * and global concurrency lease (when Redis is available), per-user rate limits
 * and a circuit breaker.
 *
 * Configured budgets are GLOBAL. Per-instance caps are ceil(budget / instances),
 * so even when Redis is down the fleet stays near budget.
 */
export class RequestScheduler {
  private queues: Record<Lane, Waiter[]> = { interactive: [], write: [], background: [] };
  private active: Record<Lane, number> = { interactive: 0, write: 0, background: 0 };
  private globalActive = 0;
  private highStreak = 0;

  private failures = 0;
  private breaker: BreakerState = "closed";
  private breakerOpenedAt = 0;
  private probeInFlight = false;

  private readonly localGlobalCap: number;
  private readonly laneCap: Record<Lane, number>;
  private readonly laneQueueMax: Record<Lane, number>;

  constructor(
    private readonly cfg: SchedulerConfig,
    private readonly coord: Coordinator,
    private readonly now: () => number = Date.now,
    private readonly breakerThreshold = 5,
    private readonly breakerCooldownMs = 10_000,
  ) {
    const per = (n: number) => Math.max(1, Math.ceil(n / cfg.instanceCount));
    this.localGlobalCap = per(cfg.maxConcurrent);
    this.laneCap = {
      interactive: per(cfg.maxReads),
      write: per(cfg.maxWrites),
      background: per(cfg.maxBackground),
    };
    this.laneQueueMax = {
      interactive: cfg.maxQueueInteractive,
      write: cfg.maxQueueWrite,
      background: cfg.maxQueueBackground,
    };
  }

  /* ---------------------------------------------------------------- public */

  async run<T>(lane: Lane, meta: RunMeta, task: (ctx: TaskContext) => Promise<T>): Promise<T> {
    await this.checkUserRate(meta.userId);

    if (this.queues[lane].length >= this.laneQueueMax[lane]) {
      throw new GatewayError("QUEUE_FULL", "The server is busy. Please retry shortly.", {
        retryable: true,
        retryAfterMs: 1000 + Math.floor(Math.random() * 1000),
      });
    }
    // Last admission check: may claim the half-open probe slot, so nothing that can throw follows it.
    this.checkBreaker();

    const queueWaitMs = await new Promise<number>((resolve, reject) => {
      const waiter: Waiter = {
        lane,
        meta,
        enqueuedAt: this.now(),
        start: resolve,
        fail: reject,
        timer: setTimeout(() => {
          const q = this.queues[lane];
          const i = q.indexOf(waiter);
          if (i >= 0) q.splice(i, 1);
          reject(new GatewayError("QUEUE_FULL", "Timed out waiting for capacity", { retryable: true, retryAfterMs: 1500 }));
        }, this.cfg.requestTimeoutMs),
      };
      this.queues[lane].push(waiter);
      this.pump();
    });

    let leaseId: string | null = null;
    try {
      leaseId = await this.acquireDistributed();
      return await task({ queueWaitMs });
    } finally {
      if (leaseId) await this.coord.releaseLease("global", leaseId).catch(() => undefined);
      this.active[lane] -= 1;
      this.globalActive -= 1;
      this.pump();
    }
  }

  /** Callers report whether the BC call looked healthy (transport/5xx/429 = failure). */
  reportOutcome(ok: boolean): void {
    if (ok) {
      this.failures = 0;
      if (this.breaker !== "closed") this.breaker = "closed";
      this.probeInFlight = false;
      return;
    }
    this.failures += 1;
    if (this.breaker === "half-open" || this.failures >= this.breakerThreshold) {
      this.breaker = "open";
      this.breakerOpenedAt = this.now();
      this.probeInFlight = false;
    }
  }

  snapshot() {
    const t = this.now();
    const oldest = Math.max(0, ...LANE_ORDER.flatMap((l) => this.queues[l].map((w) => t - w.enqueuedAt)));
    return {
      breaker: this.breaker,
      active: { ...this.active },
      queued: {
        interactive: this.queues.interactive.length,
        write: this.queues.write.length,
        background: this.queues.background.length,
      },
      oldestQueuedMs: oldest,
      coordinator: this.coord.kind,
    };
  }

  /* --------------------------------------------------------------- internals */

  private checkBreaker(): void {
    if (this.breaker === "open") {
      if (this.now() - this.breakerOpenedAt >= this.breakerCooldownMs) {
        this.breaker = "half-open";
        this.probeInFlight = false;
      } else {
        throw new GatewayError("CIRCUIT_OPEN", "Business Central is temporarily unavailable", {
          retryable: true,
          retryAfterMs: this.breakerCooldownMs,
        });
      }
    }
    if (this.breaker === "half-open") {
      if (this.probeInFlight) {
        throw new GatewayError("CIRCUIT_OPEN", "Business Central is recovering", { retryable: true, retryAfterMs: 2000 });
      }
      this.probeInFlight = true;
    }
  }

  private async checkUserRate(userId?: string): Promise<void> {
    if (!userId) return;
    const perSec = this.cfg.userRatePerMinute / 60;
    const burst = Math.max(10, Math.ceil(this.cfg.userRatePerMinute / 6));
    const wait = await this.coord.takeToken(`user:${userId}`, perSec, burst);
    if (wait > 0) {
      throw new GatewayError("RATE_LIMITED", "Too many requests", { retryable: true, retryAfterMs: wait });
    }
  }

  /** Moves queued work into execution while capacity remains. */
  private pump(): void {
    for (;;) {
      if (this.globalActive >= this.localGlobalCap) return;
      const lane = this.pickLane();
      if (!lane) return;
      const w = this.queues[lane].shift();
      if (!w) return;
      clearTimeout(w.timer);
      this.active[lane] += 1;
      this.globalActive += 1;
      w.start(this.now() - w.enqueuedAt);
    }
  }

  private eligible(lane: Lane): boolean {
    return this.queues[lane].length > 0 && this.active[lane] < this.laneCap[lane];
  }

  private pickLane(): Lane | undefined {
    const ready = LANE_ORDER.filter((l) => this.eligible(l));
    if (ready.length === 0) return undefined;
    const top = ready[0]!;
    if (top !== "background" && this.highStreak >= STARVATION_LIMIT) {
      const lower = ready.find((l) => LANE_ORDER.indexOf(l) > LANE_ORDER.indexOf(top));
      if (lower) {
        this.highStreak = 0;
        return lower;
      }
    }
    this.highStreak = top === "background" ? 0 : this.highStreak + 1;
    return top;
  }

  /** Global rate token, then a global concurrency lease. Both honour the request deadline. */
  private async acquireDistributed(): Promise<string | null> {
    const deadline = this.now() + this.cfg.requestTimeoutMs;
    const rate = this.cfg.ratePerSecond;
    for (;;) {
      const wait = await this.coord.takeToken("bc", rate, Math.max(2, rate * 2));
      if (wait === 0) break;
      if (this.now() + wait > deadline) throw new GatewayError("RATE_LIMITED", "Rate budget exhausted", { retryable: true, retryAfterMs: wait });
      await sleep(wait);
    }
    for (;;) {
      const id = await this.coord.acquireLease("global", this.cfg.maxConcurrent, this.cfg.requestTimeoutMs + 5000);
      if (id) return id;
      if (this.now() >= deadline) throw new GatewayError("QUEUE_FULL", "No capacity available", { retryable: true, retryAfterMs: 1000 });
      await sleep(25 + Math.floor(Math.random() * 75));
    }
  }
}

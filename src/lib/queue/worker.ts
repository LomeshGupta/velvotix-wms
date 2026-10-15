import { sleep } from "@/lib/business-central/retry-policy";

/**
 * Worker loop for staged WMS transactions.
 *
 * The durable queue is Business Central's staging table, NOT Redis and NOT process memory, and
 * Business Central (AL) is the authority on every outcome: it claims rows under a lease, runs
 * the handler and records Completed / Queued (retry with backoff) / Failed / Requires
 * Reconciliation itself, in the same database transaction as the handler's work. The worker
 * therefore never decides success and never "reports" a result; it only asks AL to process what
 * it has claimed and observes what AL says happened.
 *
 * A crashed worker loses nothing: its lease expires and AL requeues the row (if the handler had
 * not started) or flags it for reconciliation (if it had).
 */

export interface StagedTransaction {
  id: string;
  operationType: string;
  attemptCount: number;
}

/** What AL says happened. "lease_lost" means another worker or AL recovery now owns the row. */
export type ProcessOutcome =
  | { kind: "completed"; resultDocumentNo?: string }
  | { kind: "retry_scheduled"; errorCode: string }
  | { kind: "failed"; errorCode: string }
  | { kind: "requires_reconciliation"; errorCode: string }
  | { kind: "lease_lost" };

export interface StagingRepository {
  /** Claims up to `limit` rows with a lease and returns them. Rows are never claimed twice. */
  claimBatch(limit: number): Promise<StagedTransaction[]>;
  process(id: string, workerId: string): Promise<ProcessOutcome>;
  /** Extends the lease of a long-running transaction. */
  heartbeat(id: string, workerId: string, leaseMs: number): Promise<boolean>;
}

export interface WorkerOptions {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  onEvent?: (event: string, data: Record<string, unknown>) => void;
}

export class Worker {
  private stopping = false;
  private running = new Set<Promise<void>>();
  heartbeatAt = 0;

  constructor(
    private readonly repo: StagingRepository,
    private readonly opts: WorkerOptions,
    private readonly random: () => number = Math.random,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  /** Runs until stop(); resolves after in-flight work drains (graceful shutdown). */
  async run(): Promise<void> {
    while (!this.stopping) {
      this.heartbeatAt = Date.now();
      const free = this.opts.concurrency - this.running.size;
      let claimedAny = false;
      if (free > 0) {
        try {
          const claimed = await this.repo.claimBatch(free);
          for (const tx of claimed) {
            claimedAny = true;
            const p = this.handle(tx).finally(() => this.running.delete(p));
            this.running.add(p);
          }
        } catch (e) {
          this.opts.onEvent?.("poll_error", { name: e instanceof Error ? e.name : "unknown" });
          await this.idle(this.opts.pollIntervalMs * 2);
          continue;
        }
      }
      // Jittered idle so a fleet of workers does not poll in lockstep.
      if (!claimedAny) await this.idle(this.opts.pollIntervalMs);
      else await Promise.race([...this.running, sleep(50)]);
    }
    await Promise.allSettled([...this.running]);
  }

  private idle(ms: number): Promise<void> {
    return sleep(Math.floor(ms * (0.75 + this.random() * 0.5))).catch(() => undefined);
  }

  private async handle(tx: StagedTransaction): Promise<void> {
    const beat = setInterval(() => {
      void this.repo.heartbeat(tx.id, this.opts.workerId, this.opts.leaseMs).catch(() => undefined);
    }, Math.max(1000, Math.floor(this.opts.leaseMs / 3)));
    try {
      const outcome = await this.repo.process(tx.id, this.opts.workerId);
      this.opts.onEvent?.("processed", { id: tx.id, attempt: tx.attemptCount, outcome: outcome.kind });
    } catch (e) {
      // The result of the call is unknown (timeout, dropped connection). Never retry from here:
      // AL's own state is authoritative. If AL did finish, the row is already final; if not, the
      // lease expires and AL requeues it or flags it for reconciliation.
      this.opts.onEvent?.("process_result_unknown", { id: tx.id, name: e instanceof Error ? e.name : "unknown" });
    } finally {
      clearInterval(beat);
    }
  }
}

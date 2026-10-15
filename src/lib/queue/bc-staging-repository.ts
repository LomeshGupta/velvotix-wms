import "server-only";
import { z } from "zod";
import type { BcGateway } from "@/lib/business-central/client";
import { BC_GUID_RE } from "@/lib/business-central/guid";
import { SYSTEM_PRINCIPAL } from "@/types/principal";
import type { ProcessOutcome, StagedTransaction, StagingRepository } from "./worker";

const ClaimedSchema = z.array(z.object({ id: z.string().regex(BC_GUID_RE, "Invalid Business Central GUID"), operationType: z.string(), attemptCount: z.number().int() }));

const ProcessSchema = z.object({
  outcome: z.string(),
  id: z.string(),
  status: z.string(),
  errorClass: z.string().optional(),
  errorCode: z.string().optional().default(""),
  resultDocumentNo: z.string().optional().default(""),
  attemptCount: z.number().optional(),
});

/** Maps AL's reported state to a worker outcome. AL decided it; we only read it. */
export function mapProcessResult(raw: unknown): ProcessOutcome {
  const r = ProcessSchema.parse(raw);
  if (r.outcome === "not_owner") return { kind: "lease_lost" };
  switch (r.status) {
    case "Completed":
      return { kind: "completed", resultDocumentNo: r.resultDocumentNo || undefined };
    case "Queued":
      return { kind: "retry_scheduled", errorCode: r.errorCode };
    case "Failed":
      return { kind: "failed", errorCode: r.errorCode };
    case "Requires Reconciliation":
      return { kind: "requires_reconciliation", errorCode: r.errorCode };
    default:
      // Any other status (for example Partially Completed) is surfaced as reconciliation, never as success.
      return { kind: "requires_reconciliation", errorCode: r.errorCode || `UNEXPECTED_STATUS:${r.status}` };
  }
}

/** StagingRepository backed by the VWMSWorker web service in the Business Central extension. */
export class BcStagingRepository implements StagingRepository {
  constructor(
    private readonly gateway: BcGateway,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  async claimBatch(limit: number): Promise<StagedTransaction[]> {
    const raw = await this.gateway.invoke<unknown>(
      "worker.claimBatch",
      { workerId: this.workerId, leaseSeconds: this.leaseSeconds, maxCount: Math.max(1, Math.min(limit, 20)) },
      { principal: SYSTEM_PRINCIPAL },
    );
    return ClaimedSchema.parse(raw);
  }

  async process(id: string, workerId: string): Promise<ProcessOutcome> {
    const raw = await this.gateway.invoke<unknown>("worker.process", { transactionId: id, workerId }, { principal: SYSTEM_PRINCIPAL });
    return mapProcessResult(raw);
  }

  async heartbeat(id: string, workerId: string, leaseMs: number): Promise<boolean> {
    return this.gateway.invoke<boolean>(
      "worker.heartbeat",
      { transactionId: id, workerId, leaseSeconds: Math.ceil(leaseMs / 1000) },
      { principal: SYSTEM_PRINCIPAL },
    );
  }
}

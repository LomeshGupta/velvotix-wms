import { z } from "zod";
import type { BcGateway } from "@/lib/business-central/client";
import { GatewayError } from "@/lib/business-central/errors";
import { payloadFingerprint, scopedIdempotencyKey } from "@/lib/business-central/idempotency";
import { decodeODataEnum } from "@/lib/business-central/odata-enum";
import type { Principal } from "@/types/principal";

/**
 * Receiving: turns a scanned receipt into a durable BC staging transaction. Nothing is posted
 * here. "Accepted" only means BC stored the request; the receipt is complete when the
 * transaction reaches Completed with a result document (see the status timeline in the UI).
 */

const Code = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9._\-/ ]+$/, "Unexpected characters");

export const ReceiptInput = z.object({
  /** Generated once per receipt by the client; reusing it on retry makes the submission idempotent. */
  clientKey: z.string().uuid(),
  locationCode: Code(10),
  sourceDocumentNo: Code(20).optional(),
  lines: z
    .array(
      z.object({
        itemNo: Code(20),
        quantity: z.number().positive().max(1_000_000),
        unitOfMeasureCode: Code(10).optional(),
        lotNo: Code(50).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type ReceiptInput = z.infer<typeof ReceiptInput>;

export interface ReceiptAccepted {
  transactionId: string;
  status: string;
  duplicate: boolean;
}

export async function submitReceipt(
  gateway: BcGateway,
  principal: Principal,
  input: ReceiptInput,
  correlationId: string,
): Promise<ReceiptAccepted> {
  // The browser asks; the server decides. Location scope comes from the session, never the request.
  if (!principal.warehouseCodes.map((c) => c.toUpperCase()).includes(input.locationCode.toUpperCase())) {
    throw new GatewayError("ENDPOINT_NOT_ALLOWED", "You are not assigned to this location");
  }

  const payloadHash = payloadFingerprint({ l: input.locationCode.toUpperCase(), d: input.sourceDocumentNo ?? "", lines: input.lines });
  const body = {
    idempotencyKey: scopedIdempotencyKey(principal.userId, "Receipt", input.clientKey),
    operationType: "Receipt",
    locationCode: input.locationCode.toUpperCase(),
    wmsUserId: principal.userId,
    sourceDocumentType: input.sourceDocumentNo ? "Purchase Order" : "",
    sourceDocumentNo: input.sourceDocumentNo ?? "",
    correlationId,
    payloadHash,
    lines: input.lines.map((l, i) => ({
      lineNo: (i + 1) * 10000,
      itemNo: l.itemNo,
      quantity: l.quantity,
      unitOfMeasureCode: l.unitOfMeasureCode ?? "",
      lotNo: l.lotNo ?? "",
    })),
  };

  const result = await gateway.create("transactions.submit", body, { principal, correlationId });
  let id = String(result.body.id ?? "");
  let status = decodeODataEnum(String(result.body.status ?? "Submitted"));

  if (result.duplicate) {
    // Same key seen before. Accept only if it was the same receipt; a different payload under the
    // same key is a client bug and must never be silently merged into the earlier transaction.
    const stored = await gateway.read<{ id: string; payloadHash: string; status: string }>(
      "transactions.list",
      { select: ["id", "payloadHash", "status"], filter: [{ field: "idempotencyKey", op: "eq", value: body.idempotencyKey }], top: 1 },
      { principal: { ...principal, permissions: [...principal.permissions, "transactions:view"] }, correlationId },
    );
    const row = stored.rows[0];
    if (row && row.payloadHash && row.payloadHash.toLowerCase() !== payloadHash.toLowerCase()) {
      throw new GatewayError("BC_CONFLICT", "This receipt key was already used for different contents");
    }
    if (row) {
      id = row.id;
      status = row.status;
    }
  }
  if (!id) throw new GatewayError("OUTCOME_UNKNOWN", "The submission could not be confirmed", { outcomeUnknown: true, correlationId });
  return { transactionId: id, status, duplicate: result.duplicate };
}

export type LookedUpItem = {
  number: string;
  displayName: string;
  baseUnitOfMeasureCode: string;
  blocked: boolean;
};

/** Scan lookup: exact item number first, then barcode (GTIN). Two bounded reads, never a table scan. */
export async function lookupItem(gateway: BcGateway, principal: Principal, code: string, correlationId: string): Promise<LookedUpItem | undefined> {
  const clean = code.trim();
  if (!clean || clean.length > 50) return undefined;
  for (const field of ["number", "gtin"] as const) {
    const r = await gateway.read<LookedUpItem>(
      "items.list",
      { select: ["number", "displayName", "baseUnitOfMeasureCode", "blocked"], filter: [{ field, op: "eq", value: clean }], top: 1 },
      { principal, correlationId },
    );
    if (r.rows[0]) return r.rows[0];
  }
  return undefined;
}

import { z } from "zod";
import { payloadFingerprint, scopedIdempotencyKey } from "@/lib/business-central/idempotency";
import { getGateway, type BcGateway } from "@/lib/business-central/client";
import { decodeODataEnum } from "@/lib/business-central/odata-enum";
import { GatewayError } from "@/lib/business-central/errors";
import type { Principal } from "@/types/principal";

const Code = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9._\-/ ]+$/, "Unexpected characters");
const OptionalCode = (max: number) => Code(max).optional();

export const WMS_OPERATION_TYPES = [
  "Put-away", "Movement", "Pick", "Pack", "Ship", "Cycle Count", "Adjustment", "Return", "Quality Inspection",
] as const;
export type WmsOperationType = (typeof WMS_OPERATION_TYPES)[number];

export const OPERATION_PERMISSION: Record<WmsOperationType, string> = {
  "Put-away": "putaway:submit",
  Movement: "movements:submit",
  Pick: "picking:submit",
  Pack: "packing:submit",
  Ship: "shipping:submit",
  "Cycle Count": "cyclecounts:submit",
  Adjustment: "inventory:adjust",
  Return: "returns:submit",
  "Quality Inspection": "quality:submit",
};

export const WmsOperationInput = z.object({
  clientKey: z.string().uuid(),
  operationType: z.enum(WMS_OPERATION_TYPES),
  locationCode: Code(10),
  destinationLocationCode: OptionalCode(10),
  sourceDocumentType: z.string().trim().max(30).optional(),
  sourceDocumentNo: OptionalCode(20),
  reasonCode: OptionalCode(20),
  lines: z.array(z.object({
    itemNo: Code(20),
    quantity: z.number().positive().max(1_000_000),
    unitOfMeasureCode: OptionalCode(10),
    fromBinCode: z.string().trim().max(20).optional(),
    toBinCode: z.string().trim().max(20).optional(),
    lotNo: z.string().trim().max(50).optional(),
    serialNo: z.string().trim().max(50).optional(),
    expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sourceLineNo: z.number().int().min(0).max(2_000_000_000).optional(),
    reasonCode: OptionalCode(20),
  })).min(1).max(100),
}).superRefine((input, ctx) => {
  if (input.operationType === "Movement" && input.lines.some((l) => !l.fromBinCode || !l.toBinCode)) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Inventory movement requires a source bin and destination bin on every line" });
  }
  if (input.operationType === "Put-away" && input.lines.some((l) => !l.toBinCode)) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Put-away requires a destination bin on every line" });
  }
  if (input.operationType === "Adjustment" && !input.reasonCode && input.lines.some((l) => !l.reasonCode)) {
    ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "An adjustment reason code is required" });
  }
});
export type WmsOperationInput = z.infer<typeof WmsOperationInput>;

export interface OperationAccepted {
  transactionId: string;
  status: string;
  duplicate: boolean;
}

export async function submitWmsOperation(
  gateway: BcGateway,
  principal: Principal,
  input: WmsOperationInput,
  correlationId: string,
): Promise<OperationAccepted> {
  const assigned = new Set(principal.warehouseCodes.map((c) => c.toUpperCase()));
  const from = input.locationCode.toUpperCase();
  const to = input.destinationLocationCode?.toUpperCase();
  if (!assigned.has(from)) throw new GatewayError("ENDPOINT_NOT_ALLOWED", "You are not assigned to the source warehouse");
  if (to && !assigned.has(to)) throw new GatewayError("ENDPOINT_NOT_ALLOWED", "You are not assigned to the destination warehouse");
  if (!principal.permissions.includes(OPERATION_PERMISSION[input.operationType])) {
    throw new GatewayError("ENDPOINT_NOT_ALLOWED", "Your Business Central role does not allow this warehouse operation");
  }

  const normalisedLines = input.lines.map((l) => ({
    itemNo: l.itemNo.toUpperCase(), quantity: l.quantity,
    unitOfMeasureCode: (l.unitOfMeasureCode ?? "").toUpperCase(),
    fromBinCode: (l.fromBinCode ?? "").toUpperCase(), toBinCode: (l.toBinCode ?? "").toUpperCase(),
    lotNo: (l.lotNo ?? "").toUpperCase(), serialNo: (l.serialNo ?? "").toUpperCase(),
    expirationDate: l.expirationDate ?? "", sourceLineNo: l.sourceLineNo ?? 0,
    reasonCode: (l.reasonCode ?? input.reasonCode ?? "").toUpperCase(),
  }));
  const payloadHash = payloadFingerprint({
    type: input.operationType, from, to: to ?? "", sourceType: input.sourceDocumentType ?? "",
    source: input.sourceDocumentNo ?? "", reason: input.reasonCode ?? "", lines: normalisedLines,
  });
  const body = {
    idempotencyKey: scopedIdempotencyKey(principal.userId, input.operationType, input.clientKey),
    operationType: input.operationType,
    locationCode: from,
    destinationLocationCode: to ?? "",
    wmsUserId: principal.userId,
    sourceDocumentType: input.sourceDocumentType ?? "",
    sourceDocumentNo: input.sourceDocumentNo?.toUpperCase() ?? "",
    correlationId,
    payloadHash,
    lines: normalisedLines.map((l, i) => ({ ...l, lineNo: (i + 1) * 10000 })),
  };

  const result = await gateway.create("transactions.submit", body, { principal, correlationId });
  let id = String(result.body.id ?? "");
  let status = decodeODataEnum(String(result.body.status ?? "Submitted"));
  if (result.duplicate) {
    const stored = await gateway.read<{ id: string; payloadHash: string; status: string }>(
      "transactions.list",
      { select: ["id", "payloadHash", "status"], filter: [{ field: "idempotencyKey", op: "eq", value: body.idempotencyKey }], top: 1 },
      { principal: { ...principal, permissions: [...principal.permissions, "transactions:view"] }, correlationId },
    );
    const row = stored.rows[0];
    if (row?.payloadHash && row.payloadHash.toLowerCase() !== payloadHash.toLowerCase()) {
      throw new GatewayError("BC_CONFLICT", "This operation key was already used for different contents");
    }
    if (row) { id = row.id; status = row.status; }
  }
  if (!id) throw new GatewayError("OUTCOME_UNKNOWN", "The submission could not be confirmed", { outcomeUnknown: true, correlationId });
  return { transactionId: id, status, duplicate: result.duplicate };
}

export async function submitWmsOperationFromGateway(principal: Principal, input: WmsOperationInput, correlationId: string) {
  return submitWmsOperation(getGateway(), principal, input, correlationId);
}

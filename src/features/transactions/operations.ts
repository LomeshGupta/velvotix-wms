import { payloadFingerprint, scopedIdempotencyKey } from "@/lib/business-central/idempotency";
import { getGateway, type BcGateway } from "@/lib/business-central/client";
import { decodeODataEnum } from "@/lib/business-central/odata-enum";
import { GatewayError } from "@/lib/business-central/errors";
import type { Principal } from "@/types/principal";

import { OPERATION_PERMISSION, WmsOperationInput, type WmsOperationType } from "./schema";

export { OPERATION_PERMISSION, WMS_OPERATION_TYPES, WmsOperationInput } from "./schema";
export type { WmsOperationType } from "./schema";

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
    throw new GatewayError("ENDPOINT_NOT_ALLOWED", `Your WMS role does not include the permission "${OPERATION_PERMISSION[input.operationType]}" needed for this operation`);
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
    // BC rejects "" for Edm.Date, so an absent expiration date is omitted rather than sent empty.
    lines: normalisedLines.map(({ expirationDate, ...l }, i) => ({ ...l, ...(expirationDate ? { expirationDate } : {}), lineNo: (i + 1) * 10000 })),
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

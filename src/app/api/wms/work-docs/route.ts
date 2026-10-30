import { NextResponse } from "next/server";
import { z } from "zod";
import type { StructuredQuery } from "@/lib/validation/odata";
import { getGateway } from "@/lib/business-central/client";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One read-only gateway for the inbound work lists. Each kind names its Business Central endpoint, the
 * fields it returns, an optional document filter, and who may read it. Locations are always limited to the
 * caller's assigned warehouses (the gateway scope enforces it again).
 */
const KINDS = {
  receipts: { op: "receipts.list", select: ["id", "number", "locationCode", "assignedUserId", "postingDate", "vendorShipmentNo"], order: "number", docField: undefined, locField: "locationCode", extra: [], perms: ["receiving:submit", "putaway:submit", "transactions:view"] },
  "receipt-lines": { op: "receiptLines.list", select: ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "binCode", "zoneCode", "quantity", "qtyToReceive", "qtyOutstanding", "qtyReceived", "sourceNo", "sourceLineNo"], order: "lineNo", docField: "documentNo", locField: "locationCode", extra: [], perms: ["receiving:submit", "transactions:view"] },
  putaways: { op: "putaways.list", select: ["id", "number", "type", "locationCode", "assignedUserId"], order: "number", docField: undefined, locField: "locationCode", extra: [], perms: ["putaway:submit", "transactions:view"] },
  "putaway-lines": { op: "putawayLines.list", select: ["id", "activityNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "binCode", "zoneCode", "quantity", "qtyOutstanding", "qtyToHandle", "sourceNo", "whseDocumentNo"], order: "lineNo", docField: "activityNo", locField: "locationCode", extra: [], perms: ["putaway:submit", "transactions:view"] },
  "purchase-orders": { op: "purchaseOrders.list", select: ["id", "number", "locationCode", "vendorNo", "vendorName", "status", "expectedReceiptDate"], order: "number", docField: undefined, locField: "locationCode", extra: [{ field: "status", op: "in", value: ["Open", "Released"] }], perms: ["receiving:submit", "transactions:view"] },
  "purchase-lines": { op: "purchaseLines.list", select: ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "quantity", "qtyToReceive", "quantityReceived", "outstandingQuantity"], order: "lineNo", docField: "documentNo", locField: "locationCode", extra: [], perms: ["receiving:submit", "transactions:view"] },
  "location-setup": { op: "locationSetup.list", select: ["id", "code", "name", "requireReceive", "requirePutaway", "requirePick", "requireShipment", "binMandatory", "directedPutawayAndPick"], order: "code", docField: undefined, locField: "code", extra: [], perms: ["receiving:submit", "putaway:submit", "picking:submit", "packing:submit", "shipping:submit", "transactions:view"] },
} as const;

const Params = z.object({
  kind: z.enum(Object.keys(KINDS) as [keyof typeof KINDS, ...(keyof typeof KINDS)[]]),
  locationCode: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
  number: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_\-/. ]+$/).optional(),
});

export const GET = protectedRoute({}, async ({ req, principal, correlationId }) => {
  const parsed = Params.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "VALIDATION", "A valid kind and locationCode are required", correlationId);
  const spec = KINDS[parsed.data.kind];
  const locationCode = parsed.data.locationCode.toUpperCase();
  if (!principal.warehouseCodes.some((c) => c.toUpperCase() === locationCode)) {
    return jsonError(403, "FORBIDDEN", "You are not assigned to this warehouse", correlationId);
  }
  if (!spec.perms.some((p) => principal.permissions.includes(p))) {
    return jsonError(403, "FORBIDDEN", `Your WMS role does not include one of: ${spec.perms.join(", ")}`, correlationId);
  }
  if (spec.docField && !parsed.data.number) return jsonError(400, "VALIDATION", "A document number is required", correlationId);
  const query: StructuredQuery = {
    select: [...spec.select],
    filter: [
      { field: spec.locField, op: "eq", value: locationCode },
      ...(spec.docField ? [{ field: spec.docField, op: "eq" as const, value: parsed.data.number! }] : []),
      ...spec.extra.map((e) => ({ field: e.field, op: e.op as "in", value: [...e.value] })),
    ],
    orderBy: [{ field: spec.order, dir: "asc" }],
    top: spec.docField ? 200 : parsed.data.kind === "location-setup" ? 10 : 100,
  };
  // The listed permissions already authorise this read; give the gateway the base read right it checks.
  const readPrincipal = principal.permissions.includes("transactions:view")
    ? principal
    : { ...principal, permissions: [...principal.permissions, "transactions:view"] };
  const result = await getGateway().read(spec.op, query, { principal: readPrincipal, correlationId });
  return NextResponse.json({ rows: result.rows });
});

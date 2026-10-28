import { NextResponse } from "next/server";
import { z } from "zod";
import type { StructuredQuery } from "@/lib/validation/odata";
import { getGateway } from "@/lib/business-central/client";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  locationCode: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
  number: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
});
const LINE_SELECT = ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "quantity", "qtyToShip", "qtyOutstanding", "qtyPicked", "qtyShipped", "unitOfMeasureCode", "binCode", "sourceNo", "sourceLineNo", "status"] as const;

export const GET = protectedRoute({}, async ({ req, principal, correlationId }) => {
  const parsed = Params.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "VALIDATION", "A valid locationCode and warehouse shipment number are required", correlationId);
  const locationCode = parsed.data.locationCode.toUpperCase();
  const number = parsed.data.number.toUpperCase();
  if (!principal.warehouseCodes.some((code) => code.toUpperCase() === locationCode)) {
    return jsonError(403, "FORBIDDEN", "You are not assigned to this warehouse", correlationId);
  }
  const canWorkWithShipments = ["transactions:view", "picking:submit", "packing:submit", "shipping:submit"].some((p) => principal.permissions.includes(p));
  if (!canWorkWithShipments) return jsonError(403, "FORBIDDEN", "Your Business Central role does not allow access to shipment details", correlationId);
  const query: StructuredQuery = {
    select: [...LINE_SELECT],
    filter: [{ field: "locationCode", op: "eq", value: locationCode }, { field: "documentNo", op: "eq", value: number }],
    orderBy: [{ field: "lineNo", dir: "asc" }],
    top: 200,
  };
  const readPrincipal = principal.permissions.includes("transactions:view")
    ? principal
    : { ...principal, permissions: [...principal.permissions, "transactions:view"] };
  const result = await getGateway().read("warehouseShipmentLines.list", query, { principal: readPrincipal, correlationId });
  return NextResponse.json({ lines: result.rows, meta: { source: result.meta.source } });
});

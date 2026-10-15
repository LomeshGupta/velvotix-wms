import { NextResponse } from "next/server";
import { z } from "zod";
import type { StructuredQuery } from "@/lib/validation/odata";
import { getGateway } from "@/lib/business-central/client";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({ locationCode: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/) });
const SHIPMENT_SELECT = ["id", "number", "locationCode", "shipmentDate", "assignedUserId", "documentStatus", "status", "externalDocumentNo"] as const;

/** Lists real, released BC warehouse shipments only within the signed-in user's assigned warehouses. */
export const GET = protectedRoute({}, async ({ req, principal, correlationId }) => {
  const parsed = Params.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "VALIDATION", "A valid warehouse locationCode is required", correlationId);
  const locationCode = parsed.data.locationCode.toUpperCase();
  if (!principal.warehouseCodes.some((code) => code.toUpperCase() === locationCode)) {
    return jsonError(403, "FORBIDDEN", "You are not assigned to this warehouse", correlationId);
  }
  const canWorkWithShipments = ["transactions:view", "picking:submit", "packing:submit", "shipping:submit"].some((p) => principal.permissions.includes(p));
  if (!canWorkWithShipments) return jsonError(403, "FORBIDDEN", "Your Business Central role does not allow access to shipment work queues", correlationId);
  const query: StructuredQuery = {
    select: [...SHIPMENT_SELECT],
    filter: [{ field: "locationCode", op: "eq", value: locationCode }, { field: "status", op: "eq", value: "Released" }],
    orderBy: [{ field: "shipmentDate", dir: "asc" }],
    top: 100,
  };
  const readPrincipal = principal.permissions.includes("transactions:view")
    ? principal
    : { ...principal, permissions: [...principal.permissions, "transactions:view"] };
  const result = await getGateway().read("warehouseShipments.list", query, { principal: readPrincipal, correlationId });
  return NextResponse.json({ shipments: result.rows, meta: { source: result.meta.source } });
});

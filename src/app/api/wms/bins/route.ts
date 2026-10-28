import { NextResponse } from "next/server";
import { z } from "zod";
import type { StructuredQuery } from "@/lib/validation/odata";
import { getGateway } from "@/lib/business-central/client";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  locationCode: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
  q: z.string().trim().max(20).regex(/^[A-Za-z0-9._\-/ ]*$/).optional(),
});
const BIN_USERS = ["bins:view", "picking:submit", "movements:submit", "putaway:submit", "cyclecounts:submit", "receiving:submit", "inventory:adjust"];

/** Bins of one assigned warehouse, optionally filtered by code prefix. Used for suggestions; the server still validates on submit. */
export const GET = protectedRoute({}, async ({ req, principal, correlationId }) => {
  const parsed = Params.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "VALIDATION", "A valid locationCode is required", correlationId);
  const locationCode = parsed.data.locationCode.toUpperCase();
  if (!principal.warehouseCodes.some((c) => c.toUpperCase() === locationCode)) {
    return jsonError(403, "FORBIDDEN", "You are not assigned to this warehouse", correlationId);
  }
  if (!BIN_USERS.some((p) => principal.permissions.includes(p))) {
    return jsonError(403, "FORBIDDEN", "Your Business Central role does not allow bin lookup", correlationId);
  }
  const query: StructuredQuery = {
    select: ["id", "locationCode", "code", "description", "zoneCode"],
    filter: [
      { field: "locationCode", op: "eq", value: locationCode },
      ...(parsed.data.q ? [{ field: "code", op: "startswith" as const, value: parsed.data.q.toUpperCase() }] : []),
    ],
    orderBy: [{ field: "code", dir: "asc" }],
    top: 20,
  };
  const readPrincipal = principal.permissions.includes("bins:view")
    ? principal
    : { ...principal, permissions: [...principal.permissions, "bins:view"] };
  const result = await getGateway().read("bins.list", query, { principal: readPrincipal, correlationId });
  return NextResponse.json({ bins: result.rows });
});

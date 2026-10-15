import { NextResponse } from "next/server";
import { z } from "zod";
import { getGateway } from "@/lib/business-central/client";
import { protectedRoute } from "@/lib/security/route";
import type { StructuredQuery } from "@/lib/validation/odata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  search: z.string().trim().max(60).optional(),
  top: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const GET = protectedRoute({ permission: "items:view" }, async ({ req, principal, correlationId }) => {
  const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
  const query: StructuredQuery = {
    filter: [
      { field: "blocked", op: "eq", value: false },
      ...(p.search ? [{ field: "displayName", op: "contains" as const, value: p.search }] : []),
    ],
    orderBy: [{ field: "number" }],
    top: p.top,
    skip: p.skip,
  };
  const result = await getGateway().read("items.list", query, { principal, correlationId });
  return NextResponse.json({ items: result.rows, meta: { source: result.meta.source } });
});

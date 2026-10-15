import { NextResponse } from "next/server";
import { z } from "zod";
import { getGateway } from "@/lib/business-central/client";
import { TRANSACTION_STATUSES } from "@/lib/business-central/endpoints";
import { protectedRoute } from "@/lib/security/route";
import { TRANSACTION_LIST_SELECT } from "@/features/transactions/select";
import type { FilterClause } from "@/lib/validation/odata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  top: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).max(10_000).default(0),
});


export const GET = protectedRoute({ permission: "transactions:view" }, async ({ req, principal, correlationId }) => {
  const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
  const filter: FilterClause[] = p.status ? [{ field: "status", op: "eq", value: p.status }] : [];
  const r = await getGateway().read("transactions.list", { select: TRANSACTION_LIST_SELECT, filter, orderBy: [{ field: "requestedAt", dir: "desc" }], top: p.top, skip: p.skip }, { principal, correlationId });
  return NextResponse.json({ transactions: r.rows });
});

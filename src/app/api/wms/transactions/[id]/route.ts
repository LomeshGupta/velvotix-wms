import { NextResponse } from "next/server";
import { z } from "zod";
import { getGateway } from "@/lib/business-central/client";
import { BC_GUID_RE } from "@/lib/business-central/guid";
import { jsonError, protectedRoute } from "@/lib/security/route";
import { TRANSACTION_LIST_SELECT } from "@/features/transactions/select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.string().regex(BC_GUID_RE, "Invalid Business Central GUID");

/** Single transaction for status polling. Scoped to the user's warehouses by the registry. */
export const GET = protectedRoute({ permission: "transactions:view" }, async ({ params, principal, correlationId }) => {
  const id = Id.safeParse(params.id);
  if (!id.success) return jsonError(400, "VALIDATION", "Invalid transaction id", correlationId);
  const r = await getGateway().read("transactions.list", { select: TRANSACTION_LIST_SELECT, filter: [{ field: "id", op: "eq", value: id.data }], top: 1 }, { principal, correlationId });
  const row = r.rows[0];
  if (!row) return jsonError(404, "NOT_FOUND", "Transaction not found", correlationId);
  return NextResponse.json({ transaction: row });
});

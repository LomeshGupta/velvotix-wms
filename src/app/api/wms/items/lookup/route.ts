import { NextResponse } from "next/server";
import { z } from "zod";
import { getGateway } from "@/lib/business-central/client";
import { lookupItem } from "@/features/receiving/service";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({ code: z.string().trim().min(1).max(50) });

export const GET = protectedRoute({ permission: "items:view" }, async ({ req, principal, correlationId }) => {
  const { code } = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
  const item = await lookupItem(getGateway(), principal, code, correlationId);
  if (!item) return jsonError(404, "ITEM_NOT_FOUND", "No item matches this code", correlationId);
  return NextResponse.json({ item });
});

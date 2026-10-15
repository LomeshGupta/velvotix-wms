import { NextResponse } from "next/server";
import { getGateway } from "@/lib/business-central/client";
import { ReceiptInput, submitReceipt } from "@/features/receiving/service";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accepts a receipt. 202 means "durably stored in Business Central", not "received". */
export const POST = protectedRoute({}, async ({ req, principal, correlationId }) => {
  if (!principal.permissions.includes("receiving:submit")) {
    return jsonError(403, "FORBIDDEN", "Your Business Central role does not allow receiving", correlationId);
  }
  const input = ReceiptInput.parse(await req.json().catch(() => ({})));
  const accepted = await submitReceipt(getGateway(), principal, input, correlationId);
  return NextResponse.json(accepted, { status: 202 });
});

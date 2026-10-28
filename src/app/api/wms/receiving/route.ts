import { NextResponse } from "next/server";
import { getGateway } from "@/lib/business-central/client";
import { ReceiptInput, submitReceipt } from "@/features/receiving/service";
import { jsonError, protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accepts a receipt. 202 means "durably stored in Business Central", not "received". */
export const POST = protectedRoute({}, async ({ req, principal, correlationId }) => {
  // Both are enforced end to end (web app and AL). Name the missing one so it can be fixed.
  for (const needed of ["receiving:submit", "transactions:submit"]) {
    if (!principal.permissions.includes(needed)) {
      return jsonError(403, "FORBIDDEN", `Receiving needs the permission "${needed}", which your WMS role does not include. Ask an administrator to add it.`, correlationId);
    }
  }
  const input = ReceiptInput.parse(await req.json().catch(() => ({})));
  const accepted = await submitReceipt(getGateway(), principal, input, correlationId);
  return NextResponse.json(accepted, { status: 202 });
});

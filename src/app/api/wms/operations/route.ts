import { NextResponse } from "next/server";
import { jsonError, protectedRoute } from "@/lib/security/route";
import { WmsOperationInput, submitWmsOperation } from "@/features/transactions/operations";
import { getGateway } from "@/lib/business-central/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All warehouse writes enter the BC staging queue through one typed, idempotent route. */
export const POST = protectedRoute({}, async ({ req, principal, correlationId }) => {
  const parsed = WmsOperationInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500) || "Invalid operation", correlationId);
  const input = parsed.data;
  if (!principal.permissions.includes("transactions:submit")) {
    return jsonError(403, "FORBIDDEN", "Your Business Central user is not allowed to submit WMS operations", correlationId);
  }
  const accepted = await submitWmsOperation(getGateway(), principal, input, correlationId);
  return NextResponse.json(accepted, { status: 202 });
});

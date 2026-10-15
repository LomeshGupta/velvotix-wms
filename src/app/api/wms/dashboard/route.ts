import { NextResponse } from "next/server";
import { getGateway } from "@/lib/business-central/client";
import { TRANSACTION_STATUSES } from "@/lib/business-central/endpoints";
import { protectedRoute } from "@/lib/security/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE = 100;

/**
 * Operational summary from the most recent transactions in the user's warehouses.
 * It is a bounded sample (not a full count): BC answers one cached read for everyone in the same
 * scope, so 200 users on the dashboard cost one BC call per cache window.
 */
export const GET = protectedRoute({ permission: "dashboard:view" }, async ({ principal, correlationId }) => {
  const r = await getGateway().read<{ id: string; status: string; operationType: string; locationCode: string; requestedAt: string; errorCode: string; resultDocumentNo: string }>(
    "transactions.summary",
    { select: ["id", "status", "operationType", "locationCode", "requestedAt", "errorCode", "resultDocumentNo"], orderBy: [{ field: "requestedAt", dir: "desc" }], top: SAMPLE },
    { principal, correlationId },
  );
  const counts = Object.fromEntries(TRANSACTION_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  const byType: Record<string, number> = {};
  for (const row of r.rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    byType[row.operationType] = (byType[row.operationType] ?? 0) + 1;
  }
  const waiting = r.rows.filter((x) => x.status === "Submitted" || x.status === "Queued").map((x) => Date.parse(x.requestedAt)).filter((n) => !Number.isNaN(n));
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    maxAgeSeconds: 30,
    source: r.meta.source,
    sampleSize: r.rows.length,
    sampleLimit: SAMPLE,
    counts,
    byType,
    oldestWaitingMs: waiting.length ? Date.now() - Math.min(...waiting) : 0,
    recent: r.rows.slice(0, 8),
  });
});

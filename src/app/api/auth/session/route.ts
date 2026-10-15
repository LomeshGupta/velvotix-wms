import { NextResponse } from "next/server";
import { getConfig } from "@/lib/business-central/config";
import { protectedRoute } from "@/lib/security/route";
import { csrfTokenFor } from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = protectedRoute({}, async ({ principal, sessionIdHash }) =>
  NextResponse.json({
    user: { userId: principal.userId, displayName: principal.displayName, permissions: principal.permissions, warehouseCodes: principal.warehouseCodes },
    csrfToken: csrfTokenFor(getConfig().sessionSecret, sessionIdHash),
  }),
);

import "server-only";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/security/server-session";

const FALLBACK_WORKSPACES = [
  ["dashboard:view", "/dashboard"],
  ["receiving:submit", "/inbound/receiving"],
  ["putaway:submit", "/inbound/putaway"],
  ["items:view", "/inventory/items"],
  ["movements:submit", "/inventory/movements"],
  ["cyclecounts:submit", "/inventory/cycle-count"],
  ["inventory:adjust", "/inventory/adjustments"],
  ["picking:submit", "/outbound/picking"],
  ["packing:submit", "/outbound/packing"],
  ["shipping:submit", "/outbound/shipping"],
  ["returns:submit", "/returns"],
  ["quality:submit", "/quality/inspection"],
  ["transactions:view", "/tasks"],
  ["administration:administer", "/administration/integration-monitor"],
] as const;

/** Keep role-specific workspaces out of navigation and prevent direct URL access as well. */
export async function requireWmsPagePermission(permission: string) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  const permissions = session.principal.permissions;
  console.log("[WMS PAGE ACCESS]", {
    userId: session.principal.userId,
    requiredPermission: permission,
    effectivePermissions: session.principal.permissions,
    allowed: session.principal.permissions.includes(permission),
  });

  // SUPER grants full WMS page access.
  if (permissions.includes("SUPER")) {
    return session;
  }

  if (!permissions.includes(permission)) {
    const fallback = FALLBACK_WORKSPACES.find(
      ([candidate]) =>
        candidate !== permission && permissions.includes(candidate),
    )?.[1];

    redirect(fallback ?? "/login?reason=forbidden");
  }

  return session;
}

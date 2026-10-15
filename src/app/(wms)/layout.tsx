import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getServerSession } from "@/lib/security/server-session";

export const dynamic = "force-dynamic";

/** Every page in the product sits behind this check; the API routes enforce their own authorization too. */
export default async function WmsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { principal } = session;
  return (
    <AppShell
      user={{ displayName: principal.displayName, userId: principal.userId, roles: [...(principal.roles ?? [])], permissions: [...principal.permissions], warehouseCodes: [...principal.warehouseCodes] }}
      csrfToken={session.csrfToken}
      mockMode={session.mockMode}
    >
      {children}
    </AppShell>
  );
}

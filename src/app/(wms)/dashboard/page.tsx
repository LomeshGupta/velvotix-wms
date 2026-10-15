import type { Metadata } from "next";
import { DashboardView } from "./DashboardView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Control Tower" };
export default async function Page() {
  const session = await requireWmsPagePermission("dashboard:view");
  return <DashboardView permissions={[...session.principal.permissions]} roles={[...(session.principal.roles ?? [])]} />;
}

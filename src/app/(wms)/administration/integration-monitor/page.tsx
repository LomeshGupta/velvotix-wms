import type { Metadata } from "next";
import { requireWmsPagePermission } from "@/lib/security/page-access";
import { MonitorView } from "./MonitorView";

export const metadata: Metadata = { title: "Integration" };
export default async function Page() { await requireWmsPagePermission("administration:administer"); return <MonitorView />; }

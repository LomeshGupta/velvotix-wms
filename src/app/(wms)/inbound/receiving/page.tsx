import type { Metadata } from "next";
import { requireWmsPagePermission } from "@/lib/security/page-access";
import { ReceivingView } from "./ReceivingView";

export const metadata: Metadata = { title: "Receive" };
export default async function Page() { await requireWmsPagePermission("receiving:submit"); return <ReceivingView />; }

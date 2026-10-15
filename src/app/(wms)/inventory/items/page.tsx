import type { Metadata } from "next";
import { requireWmsPagePermission } from "@/lib/security/page-access";
import { ItemsView } from "./ItemsView";

export const metadata: Metadata = { title: "Items" };
export default async function Page() { await requireWmsPagePermission("items:view"); return <ItemsView />; }

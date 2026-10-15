import type { Metadata } from "next";
import { requireWmsPagePermission } from "@/lib/security/page-access";
import { TransactionsView } from "./TransactionsView";

export const metadata: Metadata = { title: "Transactions" };
export default async function Page() { await requireWmsPagePermission("transactions:view"); return <TransactionsView />; }

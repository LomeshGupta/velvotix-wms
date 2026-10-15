import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Put-away · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Put-away",
  permission: "putaway:submit",
  title: "Put-away",
  subtitle: "Move received stock from receiving or interim bins into storage bins.",
  sourceDocumentLabel: "Warehouse receipt / put-away no.",
  sourceDocumentType: "Warehouse Receipt",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: false,
  requireToBin: true,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Submit put-away",
  lineHeading: "Put-away lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

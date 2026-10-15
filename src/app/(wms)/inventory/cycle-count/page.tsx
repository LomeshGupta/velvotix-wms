import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Cycle counting · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Cycle Count",
  permission: "cyclecounts:submit",
  title: "Cycle counting",
  subtitle: "Capture physical counts by scan and quantity, then reconcile through Business Central.",
  sourceDocumentLabel: "Physical inventory journal / count no.",
  sourceDocumentType: "Physical Inventory",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Submit count",
  lineHeading: "Count lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

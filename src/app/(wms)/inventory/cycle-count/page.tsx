import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Cycle counting · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Cycle Count",
  permission: "cyclecounts:submit",
  title: "Cycle counting",
  subtitle: "Enter the COUNTED quantity per item (and bin). Only the difference to Business Central's quantity is posted as an adjustment; a matching count posts nothing, and 0 is a valid count. Counts are in the base unit of measure.",
  sourceDocumentLabel: "Count reference",
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

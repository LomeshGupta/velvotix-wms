import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Inventory adjustments · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Adjustment",
  permission: "inventory:adjust",
  title: "Inventory adjustments",
  subtitle: "Correct stock with a reason code. Enter a positive quantity to add stock or a negative one to remove it; name the bin at bin-managed warehouses (either bin field works).",
  sourceDocumentLabel: "Adjustment reference",
  sourceDocumentType: "Item Journal",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: true,
  reasonLabel: "Adjustment reason code",
  submitLabel: "Submit adjustment",
  lineHeading: "Adjustment lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

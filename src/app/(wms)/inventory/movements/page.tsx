import type { Metadata } from "next";
import {
  OperationWorkbenchView,
  type WorkbenchConfig,
} from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = {
  title: "Inventory movements · Velvotix WMS",
};
const config: WorkbenchConfig = {
  operationType: "Movement",
  permission: "movements:submit",
  title: "Inventory movements",
  subtitle:
    "Move stock bin-to-bin, or to another warehouse, with a standard Business Central item reclassification. Bin-managed warehouses need the bin on each side. Warehouses with directed put-away and pick use Business Central's warehouse journals instead.",
  sourceDocumentLabel: "Movement reference",
  sourceDocumentType: "Internal Movement",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: true,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Submit movement",
  lineHeading: "Movement lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

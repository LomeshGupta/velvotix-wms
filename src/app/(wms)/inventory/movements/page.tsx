import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Inventory movements · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Movement",
  permission: "movements:submit",
  title: "Inventory movements",
  subtitle: "Execute auditable bin-to-bin or warehouse-to-warehouse inventory movement.",
  sourceDocumentLabel: "Movement reference",
  sourceDocumentType: "Internal Movement",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: true,
  requireToBin: true,
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

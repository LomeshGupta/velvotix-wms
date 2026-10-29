import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Create pick · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Create Pick",
  permission: "picking:submit",
  title: "Create pick",
  subtitle: "Create the warehouse pick for a released shipment. Untick a line (quantity 0) to leave it out; a pick always covers a line's whole open quantity.",
  sourceDocumentLabel: "Warehouse shipment no.",
  sourceDocumentType: "Warehouse Shipment",
  sourceDocumentRequired: true,
  selectWarehouseShipment: true,
  showBins: false,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Create pick",
  lineHeading: "Lines to pick",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

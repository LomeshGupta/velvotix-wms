import type { Metadata } from "next";
import {
  OperationWorkbenchView,
  type WorkbenchConfig,
} from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Order picking · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Pick",
  permission: "picking:submit",
  title: "Order picking",
  subtitle:
    "Pick against a Business Central warehouse shipment. Scan items, bins, and tracking values.",
  sourceDocumentLabel: "Warehouse shipment no.",
  sourceDocumentType: "Warehouse Shipment",
  sourceDocumentRequired: true,
  selectWarehouseShipment: true,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Submit pick",
  lineHeading: "Pick lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

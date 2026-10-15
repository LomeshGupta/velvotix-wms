import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Shipment dispatch · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Ship",
  permission: "shipping:submit",
  title: "Shipment dispatch",
  subtitle: "Confirm staged shipment lines and request Business Central shipment posting.",
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
  submitLabel: "Submit shipment",
  lineHeading: "Shipment lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

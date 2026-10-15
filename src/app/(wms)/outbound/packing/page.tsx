import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Packing station · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Pack",
  permission: "packing:submit",
  title: "Packing station",
  subtitle: "Verify picked goods against the shipment before the shipment can be closed.",
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
  submitLabel: "Submit packing verification",
  lineHeading: "Packed lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

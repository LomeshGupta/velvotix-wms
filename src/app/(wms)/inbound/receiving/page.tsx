import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Receive · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Receipt",
  permission: "receiving:submit",
  title: "Receive goods",
  subtitle: "Receive against a Business Central document. Warehouse locations receive on a warehouse receipt (created from the purchase order automatically); basic locations receive the purchase order directly. Partial quantities are fine.",
  sourceDocumentLabel: "Receipt / purchase order",
  sourceDocumentType: "Purchase Order",
  sourceDocumentRequired: true,
  selectWarehouseShipment: true,
  documentKind: "inbound",
  showBins: false,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Post receipt",
  lineHeading: "Lines to receive",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

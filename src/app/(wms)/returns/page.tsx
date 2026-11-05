import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Returns processing · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Return",
  permission: "returns:submit",
  title: "Returns processing",
  subtitle: "Receive returned goods against a sales return order. Warehouse locations receive on a warehouse receipt (created from the return order automatically, then put away); basic locations receive the return order directly. No credit memo is posted.",
  sourceDocumentLabel: "Sales return order no.",
  sourceDocumentType: "Sales Return Order",
  sourceDocumentRequired: true,
  selectWarehouseShipment: true,
  documentKind: "return",
  showBins: false,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Return condition / reason",
  submitLabel: "Submit return",
  lineHeading: "Return lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

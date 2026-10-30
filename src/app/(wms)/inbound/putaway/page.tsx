import type { Metadata } from "next";
import {
  OperationWorkbenchView,
  type WorkbenchConfig,
} from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Put-away · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Put-away",
  permission: "putaway:submit",
  title: "Put-away",
  subtitle:
    "Register a put-away created by Business Central when a receipt was posted. Confirm or change the destination bin; partial quantities are fine.",
  sourceDocumentLabel: "Put-away no.",
  sourceDocumentType: "Put-away",
  sourceDocumentRequired: true,
  selectWarehouseShipment: true,
  documentKind: "putaway",
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: false,
  reasonLabel: "Reason code",
  submitLabel: "Submit put-away",
  lineHeading: "Put-away lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

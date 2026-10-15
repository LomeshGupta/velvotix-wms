import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Returns processing · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Return",
  permission: "returns:submit",
  title: "Returns processing",
  subtitle: "Capture returned stock by source return document, item, condition and tracking.",
  sourceDocumentLabel: "Sales return order no.",
  sourceDocumentType: "Sales Return Order",
  sourceDocumentRequired: true,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: true,
  reasonLabel: "Return condition / reason",
  submitLabel: "Submit return",
  lineHeading: "Return lines",
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

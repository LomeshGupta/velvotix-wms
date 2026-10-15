import type { Metadata } from "next";
import { OperationWorkbenchView, type WorkbenchConfig } from "@/components/workbench/OperationWorkbenchView";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "Quality inspection · Velvotix WMS" };
const config: WorkbenchConfig = {
  operationType: "Quality Inspection",
  permission: "quality:submit",
  title: "Quality inspection",
  subtitle: "Record incoming or returned stock inspection outcomes for a traceable review.",
  sourceDocumentLabel: "Receipt / source document no.",
  sourceDocumentType: "Warehouse Receipt",
  sourceDocumentRequired: false,
  showBins: true,
  requireFromBin: false,
  requireToBin: false,
  allowDestinationWarehouse: false,
  requireReason: true,
  reasonLabel: "Inspection result",
  submitLabel: "Submit inspection",
  lineHeading: "Inspected lines",
  reasonOptions: [{ value: "PASS", label: "Pass / release" }, { value: "HOLD", label: "Hold for review" }, { value: "REJECT", label: "Reject" }],
};

export default async function Page() {
  await requireWmsPagePermission(config.permission);
  return <OperationWorkbenchView config={config} />;
}

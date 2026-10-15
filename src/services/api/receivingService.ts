import { bcRequest } from "./bcRequest";
import type { ReceiptPayload, SubmitResult } from "./schemas";

export function submitReceipt(payload: ReceiptPayload): Promise<SubmitResult> {
  return bcRequest<SubmitResult>("/api/wms/receiving", { method: "POST", body: payload });
}

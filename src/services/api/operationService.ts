import { bcRequest } from "./bcRequest";
import type { SubmitResult, WmsOperationPayload } from "./schemas";

export function submitOperation(payload: WmsOperationPayload): Promise<SubmitResult> {
  return bcRequest<SubmitResult>("/api/wms/operations", { method: "POST", body: payload });
}

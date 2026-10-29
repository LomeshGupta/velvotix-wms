import { z } from "zod";

const Code = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9._\-/ ]+$/, "Unexpected characters");
const OptionalCode = (max: number) => Code(max).optional();

export const WMS_OPERATION_TYPES = [
  "Put-away", "Movement", "Pick", "Pack", "Ship", "Cycle Count", "Adjustment", "Return", "Quality Inspection", "Create Pick",
] as const;
export type WmsOperationType = (typeof WMS_OPERATION_TYPES)[number];

export const OPERATION_PERMISSION: Record<WmsOperationType, string> = {
  "Create Pick": "picking:submit",
  "Put-away": "putaway:submit",
  Movement: "movements:submit",
  Pick: "picking:submit",
  Pack: "packing:submit",
  Ship: "shipping:submit",
  "Cycle Count": "cyclecounts:submit",
  Adjustment: "inventory:adjust",
  Return: "returns:submit",
  "Quality Inspection": "quality:submit",
};

export const WmsOperationInput = z.object({
  clientKey: z.string().uuid(),
  operationType: z.enum(WMS_OPERATION_TYPES),
  locationCode: Code(10),
  destinationLocationCode: OptionalCode(10),
  sourceDocumentType: z.string().trim().max(30).optional(),
  sourceDocumentNo: OptionalCode(20),
  reasonCode: OptionalCode(20),
  lines: z.array(z.object({
    itemNo: Code(20),
    quantity: z.number().positive().max(1_000_000),
    unitOfMeasureCode: OptionalCode(10),
    fromBinCode: z.string().trim().max(20).optional(),
    toBinCode: z.string().trim().max(20).optional(),
    lotNo: z.string().trim().max(50).optional(),
    serialNo: z.string().trim().max(50).optional(),
    expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sourceLineNo: z.number().int().min(0).max(2_000_000_000).optional(),
    reasonCode: OptionalCode(20),
  })).min(1).max(100),
}).superRefine((input, ctx) => {
  if (input.operationType === "Movement" && input.lines.some((l) => !l.fromBinCode || !l.toBinCode)) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Inventory movement requires a source bin and destination bin on every line" });
  }
  if (input.operationType === "Put-away" && input.lines.some((l) => !l.toBinCode)) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Put-away requires a destination bin on every line" });
  }
  if (input.operationType === "Pick" || input.operationType === "Ship" || input.operationType === "Pack" || input.operationType === "Create Pick") {
    if (!input.sourceDocumentNo) ctx.addIssue({ code: "custom", path: ["sourceDocumentNo"], message: "A warehouse shipment number is required" });
    if (input.lines.some((l) => !l.sourceLineNo)) ctx.addIssue({ code: "custom", path: ["lines"], message: "Every line must reference its warehouse shipment line" });
    const seen = new Set<number>();
    for (const l of input.lines) {
      if (l.sourceLineNo && seen.has(l.sourceLineNo)) { ctx.addIssue({ code: "custom", path: ["lines"], message: "A warehouse shipment line can appear only once" }); break; }
      if (l.sourceLineNo) seen.add(l.sourceLineNo);
    }
  }
  if (input.operationType === "Adjustment" && !input.reasonCode && input.lines.some((l) => !l.reasonCode)) {
    ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "An adjustment reason code is required" });
  }
});
export type WmsOperationInput = z.infer<typeof WmsOperationInput>;


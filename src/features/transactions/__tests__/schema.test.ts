import { describe, expect, it } from "vitest";
import { WmsOperationInput } from "../schema";

const base = {
  clientKey: "7b0f3c0e-6f4e-4a6a-9d1a-1c2b3c4d5e6f",
  locationCode: "MAIN",
  sourceDocumentType: "Warehouse Shipment",
  sourceDocumentNo: "WS000001",
};
const line = (over: Record<string, unknown> = {}) => ({ itemNo: "ITEM1", quantity: 2, sourceLineNo: 10000, ...over });

describe("WmsOperationInput – pick and ship", () => {
  it("accepts a valid pick", () => {
    expect(WmsOperationInput.safeParse({ ...base, operationType: "Pick", lines: [line({ fromBinCode: "A-01" })] }).success).toBe(true);
  });
  it("rejects pick without a shipment number", () => {
    expect(WmsOperationInput.safeParse({ ...base, sourceDocumentNo: undefined, operationType: "Pick", lines: [line()] }).success).toBe(false);
  });
  it("rejects lines without a shipment line reference", () => {
    expect(WmsOperationInput.safeParse({ ...base, operationType: "Ship", lines: [line({ sourceLineNo: undefined })] }).success).toBe(false);
  });
  it("rejects the same shipment line twice", () => {
    expect(WmsOperationInput.safeParse({ ...base, operationType: "Ship", lines: [line(), line()] }).success).toBe(false);
  });
  it("rejects zero, negative and absurd quantities", () => {
    for (const quantity of [0, -1, 2_000_000]) {
      expect(WmsOperationInput.safeParse({ ...base, operationType: "Pick", lines: [line({ quantity })] }).success).toBe(false);
    }
  });
  it("rejects injection-like codes", () => {
    expect(WmsOperationInput.safeParse({ ...base, locationCode: "MAIN'; DROP", operationType: "Pick", lines: [line()] }).success).toBe(false);
  });
  it("still requires bins for movements", () => {
    expect(WmsOperationInput.safeParse({ clientKey: base.clientKey, locationCode: "MAIN", operationType: "Movement", lines: [{ itemNo: "I", quantity: 1 }] }).success).toBe(false);
  });
});

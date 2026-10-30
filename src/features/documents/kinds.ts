/**
 * Work-document kinds the workbench can select from, and the normalisation from Business Central
 * rows to what the screen shows. Pure functions (unit tested); no server or UI dependencies.
 */
import { createPickQuantity, packableQuantity, pickableQuantity, shippableQuantity, type ShipmentLineQty } from "@/features/transactions/quantities";

export type DocKind = "shipment" | "receipt" | "purchase" | "putaway";
export type DocumentKindConfig = "shipment" | "inbound" | "putaway";

export interface LocationSetup {
  code: string;
  name?: string;
  requireReceive: boolean;
  requirePutaway: boolean;
  requirePick: boolean;
  requireShipment: boolean;
  binMandatory: boolean;
  directedPutawayAndPick: boolean;
}

/** Inbound follows the location: warehouse receipt when it requires receive, otherwise the purchase order directly. */
export function resolveDocKind(config: DocumentKindConfig | undefined, setup: LocationSetup | undefined): DocKind {
  if (config === "putaway") return "putaway";
  if (config === "inbound") return setup?.requireReceive === false ? "purchase" : "receipt";
  return "shipment";
}

/** Business Central's source document type (and put-away) as the AL handlers expect them. */
export function sourceDocumentTypeFor(kind: DocKind, fallback: string): string {
  switch (kind) {
    case "receipt": return "Warehouse Receipt";
    case "purchase": return "Purchase Order";
    case "putaway": return "Put-away";
    default: return fallback;
  }
}

/** Inventory put-away location (put-away without a warehouse receipt): receipts come from Business Central's put-away. */
export function isInventoryPutawayLocation(setup: LocationSetup | undefined): boolean {
  return Boolean(setup && !setup.requireReceive && setup.requirePutaway);
}

export interface WorkDoc { id: string; number: string; documentStatus: string; externalDocumentNo: string }
export interface WorkLineRow {
  id: string; lineNo: number; itemNo: string; description: string; unitOfMeasureCode: string; binCode?: string;
  /** What this step can still handle on the line, from Business Central's own quantities. */
  remaining: number;
  /** Shown on the line when present (shipments). */
  sourceNo?: string; qtyPicked?: number; status?: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

export function toWorkDoc(kind: DocKind, r: Row): WorkDoc {
  switch (kind) {
    case "receipt": return { id: s(r.id), number: s(r.number), documentStatus: "Warehouse receipt", externalDocumentNo: s(r.vendorShipmentNo) };
    case "purchase": return { id: s(r.id), number: s(r.number), documentStatus: s(r.status) || "Purchase order", externalDocumentNo: s(r.vendorName) };
    case "putaway": return { id: s(r.id), number: s(r.number), documentStatus: s(r.type) || "Put-away", externalDocumentNo: "" };
    default: return { id: s(r.id), number: s(r.number), documentStatus: s(r.documentStatus), externalDocumentNo: s(r.externalDocumentNo) };
  }
}

export function toWorkLine(kind: DocKind, operationType: string, r: Row): WorkLineRow {
  const base = { id: s(r.id), itemNo: s(r.itemNo), description: s(r.description), unitOfMeasureCode: s(r.unitOfMeasureCode), lineNo: n(r.lineNo), sourceNo: s(r.sourceNo) || undefined, qtyPicked: r.qtyPicked === undefined ? undefined : n(r.qtyPicked), status: s(r.status) || undefined };
  switch (kind) {
    case "receipt": return { ...base, binCode: s(r.binCode) || undefined, remaining: Math.max(n(r.qtyOutstanding), 0) };
    case "purchase": return { ...base, remaining: Math.max(n(r.outstandingQuantity), 0) };
    case "putaway": return { ...base, binCode: s(r.binCode) || undefined, remaining: Math.max(n(r.qtyOutstanding), 0) };
    default: {
      const l = r as unknown as ShipmentLineQty;
      const remaining = operationType === "Create Pick" ? createPickQuantity(l)
        : operationType === "Pick" ? pickableQuantity(l)
        : operationType === "Pack" ? packableQuantity(l)
        : shippableQuantity(l);
      return { ...base, binCode: s(r.binCode) || undefined, remaining };
    }
  }
}

export const remainingLabel = (operationType: string): string => ({
  "Create Pick": "To create pick", Pick: "To pick", Pack: "To pack", Ship: "Ready to ship",
  Receipt: "To receive", "Put-away": "To put away",
} as Record<string, string>)[operationType] ?? "Open";

export const documentNoun = (kind: DocKind): string => ({ shipment: "order", receipt: "warehouse receipt", purchase: "purchase order", putaway: "put-away" })[kind];

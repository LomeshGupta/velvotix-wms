import { bcRequest } from "./bcRequest";

export type WorkDocApiKind = "receipts" | "receipt-lines" | "putaways" | "putaway-lines" | "purchase-orders" | "purchase-lines" | "location-setup";

export function getWorkRows(kind: WorkDocApiKind, locationCode: string, number?: string, signal?: AbortSignal): Promise<{ rows: Record<string, unknown>[] }> {
  const params = new URLSearchParams({ kind, locationCode });
  if (number) params.set("number", number);
  return bcRequest<{ rows: Record<string, unknown>[] }>(`/api/wms/work-docs?${params.toString()}`, { signal });
}

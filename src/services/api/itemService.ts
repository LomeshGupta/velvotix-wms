import { bcRequest } from "./bcRequest";
import type { ItemHit } from "./schemas";

export function searchItems(search = "", signal?: AbortSignal): Promise<{ items: ItemHit[] }> {
  const params = new URLSearchParams({ top: "50" });
  if (search) params.set("search", search);
  return bcRequest<{ items: ItemHit[] }>(`/api/wms/items?${params.toString()}`, { signal });
}

export function lookupItem(code: string): Promise<{ item: ItemHit }> {
  const params = new URLSearchParams({ code });
  return bcRequest<{ item: ItemHit }>(`/api/wms/items/lookup?${params.toString()}`);
}

import { bcRequest } from "./bcRequest";
import type { BinHit } from "./schemas";

export function getBins(locationCode: string, q: string, signal?: AbortSignal): Promise<{ bins: BinHit[] }> {
  const params = new URLSearchParams({ locationCode });
  if (q) params.set("q", q);
  return bcRequest<{ bins: BinHit[] }>(`/api/wms/bins?${params.toString()}`, { signal });
}

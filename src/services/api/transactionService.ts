import { bcRequest } from "./bcRequest";
import type { TransactionRow } from "./schemas";

export function getTransactions(status?: string, signal?: AbortSignal): Promise<{ transactions: TransactionRow[] }> {
  const params = new URLSearchParams({ top: "100" });
  if (status) params.set("status", status);
  return bcRequest<{ transactions: TransactionRow[] }>(`/api/wms/transactions?${params.toString()}`, { signal });
}

export function getTransaction(id: string, signal?: AbortSignal): Promise<{ transaction: TransactionRow }> {
  return bcRequest<{ transaction: TransactionRow }>(`/api/wms/transactions/${encodeURIComponent(id)}`, { signal });
}

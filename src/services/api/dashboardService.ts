import { bcRequest } from "./bcRequest";
import type { DashboardData } from "./schemas";

export function getDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return bcRequest<DashboardData>("/api/wms/dashboard", { signal });
}

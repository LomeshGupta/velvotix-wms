import { bcRequest } from "./bcRequest";
import type { MonitorData } from "./schemas";

export function getMonitor(signal?: AbortSignal): Promise<MonitorData> {
  return bcRequest<MonitorData>("/api/wms/admin/monitor", { signal });
}

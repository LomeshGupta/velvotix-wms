import { bcRequest } from "./bcRequest";
import type { WarehouseShipmentHit, WarehouseShipmentLineHit } from "./schemas";

export function getWarehouseShipments(locationCode: string, signal?: AbortSignal): Promise<{ shipments: WarehouseShipmentHit[] }> {
  const params = new URLSearchParams({ locationCode });
  return bcRequest<{ shipments: WarehouseShipmentHit[] }>(`/api/wms/shipments?${params.toString()}`, { signal });
}

export function getWarehouseShipmentLines(locationCode: string, number: string, signal?: AbortSignal): Promise<{ lines: WarehouseShipmentLineHit[] }> {
  const params = new URLSearchParams({ locationCode, number });
  return bcRequest<{ lines: WarehouseShipmentLineHit[] }>(`/api/wms/shipment-lines?${params.toString()}`, { signal });
}

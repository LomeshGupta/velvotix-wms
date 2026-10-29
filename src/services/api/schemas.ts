/** Shared client-side API types for the WMS services. */
export interface TransactionRow {
  id: string;
  operationType: string;
  status: string;
  locationCode: string;
  destinationLocationCode?: string;
  wmsUserId?: string;
  attemptCount?: number;
  errorCode?: string;
  errorMessage?: string;
  resultDocumentNo?: string;
  sourceDocumentNo?: string;
  requestedAt?: string;
  completedAt?: string | null;
}

export interface DashboardData {
  generatedAt: string;
  maxAgeSeconds: number;
  source: string;
  sampleSize: number;
  sampleLimit: number;
  counts: Record<string, number>;
  byType: Record<string, number>;
  oldestWaitingMs: number;
  recent: TransactionRow[];
}

export interface WarehouseShipmentHit {
  id: string;
  number: string;
  locationCode: string;
  shipmentDate?: string;
  assignedUserId?: string;
  documentStatus?: string;
  status?: string;
  externalDocumentNo?: string;
}

export interface WarehouseShipmentLineHit {
  id: string;
  documentNo: string;
  lineNo: number;
  locationCode: string;
  itemNo: string;
  description: string;
  quantity: number;
  qtyToShip: number;
  qtyOutstanding: number;
  qtyPicked: number;
  qtyShipped?: number;
  pickQty?: number;
  qtyPacked?: number;
  unitOfMeasureCode: string;
  binCode?: string;
  sourceNo?: string;
  sourceLineNo?: number;
  status?: string;
}

export interface BinHit {
  id: string;
  locationCode: string;
  code: string;
  description?: string;
  zoneCode?: string;
}

export interface ItemHit {
  number: string;
  displayName: string;
  baseUnitOfMeasureCode: string;
  blocked: boolean;
  gtin?: string;
  inventory?: number;
}

export interface ReceiptPayload {
  clientKey: string;
  locationCode: string;
  sourceDocumentNo?: string;
  lines: { itemNo: string; quantity: number; unitOfMeasureCode?: string; lotNo?: string }[];
}

export type WmsOperationType = "Put-away" | "Movement" | "Pick" | "Pack" | "Ship" | "Cycle Count" | "Adjustment" | "Return" | "Quality Inspection" | "Create Pick";

export interface WmsOperationPayload {
  clientKey: string;
  operationType: WmsOperationType;
  locationCode: string;
  destinationLocationCode?: string;
  sourceDocumentType?: string;
  sourceDocumentNo?: string;
  reasonCode?: string;
  lines: {
    itemNo: string;
    quantity: number;
    unitOfMeasureCode?: string;
    fromBinCode?: string;
    toBinCode?: string;
    lotNo?: string;
    serialNo?: string;
    expirationDate?: string;
    sourceLineNo?: number;
    reasonCode?: string;
  }[];
}

export interface SubmitResult {
  transactionId: string;
  status: string;
  duplicate: boolean;
}

export interface MonitorData {
  generatedAt: string;
  mode: string;
  environment: string;
  redis: string;
  scheduler: { breaker: string; active: Record<string, number>; queued: Record<string, number>; oldestQueuedMs: number; coordinator: string };
  limits: Record<string, number>;
  metrics: { lastSuccessAt?: number; authFailures: number; operations: Record<string, { count: number; errors: number; throttled: number; cacheHits: number; deduped: number; p50: number; p95: number; p99: number; queueWaitP95: number }> };
}

export interface LoginResponse {
  user: {
    userId: string;
    displayName: string;
    roles: string[];
    permissions: string[];
    warehouseCodes: string[];
    mustChangePassword: boolean;
  };
  csrfToken: string;
}

export interface SessionResponse {
  user: { userId: string; displayName: string; permissions: string[]; warehouseCodes: string[] };
  csrfToken: string;
}

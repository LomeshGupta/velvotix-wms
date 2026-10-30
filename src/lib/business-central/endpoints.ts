import type { FieldSpec, FilterClause, QuerySpec } from "@/lib/validation/odata";
import type { Principal } from "@/types/principal";
import { perm, SYSTEM_PERMISSION } from "@/types/principal";
import type { WmsConfig } from "./config";

/**
 * The ONLY way to reach Business Central. Callers name an operation key; they never supply
 * URLs, hosts, paths, entity names or raw OData. Anything not registered here cannot be called.
 *
 * "standard" = Microsoft standard API v2.0 (reads only).
 * "custom"   = Velvotix WMS API pages (publisher velvotix / group wms / v1.0), defined by the
 *              AL extension in al/. Entity and field names here MUST match those API pages.
 * "action"   = unbound OData action on a published WMS codeunit web service (VWMSWorker / VWMSAuth).
 */

export type CacheClass = "reference" | "availability" | "dashboard" | "none";
export type Lane = "interactive" | "write" | "background";

interface BaseOp {
  lane: Lane;
  permission: string;
}

export interface ReadOp extends BaseOp {
  method: "GET";
  api: "standard" | "custom";
  entity: string;
  query: QuerySpec;
  cache: CacheClass;
  tags: readonly string[];
  /** Server-applied row scope derived from the principal. */
  scope?: (p: Principal) => FilterClause[];
}

export interface CreateOp extends BaseOp {
  method: "POST";
  api: "custom";
  entity: string;
  lane: "write";
  invalidates: readonly string[];
  /** When true the body must carry an idempotencyKey and duplicates are reconciled. */
  idempotent: boolean;
}

export interface PatchOp extends BaseOp {
  method: "PATCH";
  api: "custom";
  entity: string;
  lane: "write";
  /** Only these body fields may be sent. */
  fields: Readonly<Record<string, "string" | "number" | "boolean" | "nullable-string">>;
  invalidates: readonly string[];
}

export interface ActionOp extends BaseOp {
  method: "ACTION";
  service: "VWMSWorker" | "VWMSAuth";
  action: string;
  /** Exact parameter names and types the AL procedure declares. */
  params: Readonly<Record<string, "string" | "number">>;
  /** How the AL procedure's return value is delivered. */
  returns: "json-text" | "text" | "boolean";
}

export type Operation = ReadOp | CreateOp | PatchOp | ActionOp;

const warehouseScope = (field: string) => (p: Principal): FilterClause[] => [
  // Empty assignment must never mean "everything": it matches nothing.
  { field, op: "in", value: p.warehouseCodes.length ? p.warehouseCodes : ["__none__"] },
];

export const TRANSACTION_STATUSES = [
  "Draft", "Submitted", "Queued", "Processing", "Awaiting Approval",
  "Completed", "Partially Completed", "Failed", "Cancelled", "Requires Reconciliation",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const OPERATION_TYPES = [
  "Diagnostic", "Receipt", "Put-away", "Movement", "Pick", "Pack", "Ship", "Cycle Count", "Adjustment", "Return", "Quality Inspection", "Create Pick",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

const f = (spec: FieldSpec): FieldSpec => spec;

const TRANSACTION_QUERY: QuerySpec = {
  maxTop: 100, defaultTop: 25,
  defaultSelect: ["id", "idempotencyKey", "operationType", "status", "locationCode", "destinationLocationCode", "attemptCount", "errorCode", "resultDocumentNo"],
  fields: {
    id: f({ type: "guid", filterable: true }),
    idempotencyKey: f({ type: "string", filterable: true, ops: ["eq"] }),
    operationType: f({ type: "enum", values: OPERATION_TYPES, filterable: true }),
    status: f({ type: "enum", values: TRANSACTION_STATUSES, filterable: true }),
    locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
    destinationLocationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
    wmsUserId: f({ type: "string", filterable: true }),
    attemptCount: f({ type: "number" }),
    errorCode: f({ type: "string" }),
    errorMessage: f({ type: "string" }),
    resultDocumentNo: f({ type: "string" }),
    payloadHash: f({ type: "string" }),
    sourceDocumentNo: f({ type: "string" }),
    requestedAt: f({ type: "date", filterable: true, sortable: true }),
    completedAt: f({ type: "date", sortable: true }),
  },
};

export const OPERATIONS = {
  /* ------------------------------------------------------------ standard reads */
  "items.list": {
    api: "standard", entity: "items", method: "GET", lane: "interactive",
    permission: perm("items", "view"), cache: "reference", tags: ["items"],
    query: {
      maxTop: 100, defaultTop: 25,
      defaultSelect: ["number", "displayName", "baseUnitOfMeasureCode", "blocked", "gtin", "inventory"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        number: f({ type: "string", filterable: true, sortable: true }),
        displayName: f({ type: "string", filterable: true, sortable: true }),
        itemCategoryCode: f({ type: "string", filterable: true }),
        baseUnitOfMeasureCode: f({ type: "string" }),
        gtin: f({ type: "string", filterable: true, ops: ["eq"] }),
        blocked: f({ type: "boolean", filterable: true }),
        inventory: f({ type: "number" }),
        lastModifiedDateTime: f({ type: "date", filterable: true, sortable: true }),
      },
    },
  },
  "locations.list": {
    api: "standard", entity: "locations", method: "GET", lane: "interactive",
    permission: perm("locations", "view"), cache: "reference", tags: ["locations"],
    query: {
      maxTop: 200, defaultTop: 50, defaultSelect: ["code", "displayName"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        code: f({ type: "string", filterable: true, sortable: true }),
        displayName: f({ type: "string", filterable: true }),
      },
    },
  },
  "warehouseShipments.list": {
    api: "custom", entity: "warehouseShipments", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["warehouseShipments"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 100, defaultTop: 50,
      defaultSelect: ["id", "number", "locationCode", "shipmentDate", "assignedUserId", "documentStatus", "status", "externalDocumentNo"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        number: f({ type: "string", filterable: true, sortable: true, ops: ["eq"] }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        shipmentDate: f({ type: "date", filterable: true, sortable: true }),
        assignedUserId: f({ type: "string", filterable: true, ops: ["eq"] }),
        documentStatus: f({ type: "enum", values: [" ", "Partially Picked", "Completely Picked", "Partially Shipped", "Completely Shipped"], filterable: true, ops: ["eq"] }),
        status: f({ type: "string", filterable: true, ops: ["eq"] }),
        externalDocumentNo: f({ type: "string" }),
      },
    },
  },
  "warehouseShipmentLines.list": {
    api: "custom", entity: "warehouseShipmentLines", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["warehouseShipments"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 200, defaultTop: 100,
      defaultSelect: ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "quantity", "qtyToShip", "qtyOutstanding", "qtyPicked", "qtyShipped", "pickQty", "qtyPacked", "unitOfMeasureCode", "binCode", "sourceNo", "sourceLineNo", "status"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        documentNo: f({ type: "string", filterable: true, ops: ["eq"] }),
        lineNo: f({ type: "number", filterable: true, sortable: true }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        itemNo: f({ type: "string", filterable: true, ops: ["eq"] }),
        description: f({ type: "string" }),
        quantity: f({ type: "number" }),
        qtyToShip: f({ type: "number" }),
        qtyOutstanding: f({ type: "number" }),
        qtyPicked: f({ type: "number" }),
        qtyShipped: f({ type: "number" }),
        pickQty: f({ type: "number" }),
        qtyPacked: f({ type: "number" }),
        unitOfMeasureCode: f({ type: "string" }),
        binCode: f({ type: "string", filterable: true, ops: ["eq"] }),
        sourceNo: f({ type: "string" }),
        sourceLineNo: f({ type: "number" }),
        status: f({ type: "enum", values: [" ", "Partially Picked", "Completely Picked", "Partially Shipped", "Completely Shipped"] }),
      },
    },
  },

  "receipts.list": {
    api: "custom", entity: "warehouseReceipts", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["warehouseReceipts"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 100, defaultTop: 50,
      defaultSelect: ["id", "number", "locationCode", "assignedUserId", "postingDate", "vendorShipmentNo"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        number: f({ type: "string", filterable: true, sortable: true, ops: ["eq"] }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        assignedUserId: f({ type: "string" }),
        postingDate: f({ type: "date", sortable: true }),
        vendorShipmentNo: f({ type: "string" }),
      },
    },
  },
  "receiptLines.list": {
    api: "custom", entity: "warehouseReceiptLines", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["warehouseReceipts"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 200, defaultTop: 100,
      defaultSelect: ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "binCode", "zoneCode", "quantity", "qtyToReceive", "qtyOutstanding", "qtyReceived", "sourceNo", "sourceLineNo"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        documentNo: f({ type: "string", filterable: true, ops: ["eq"] }),
        lineNo: f({ type: "number", sortable: true }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        itemNo: f({ type: "string" }), description: f({ type: "string" }), unitOfMeasureCode: f({ type: "string" }),
        binCode: f({ type: "string" }), zoneCode: f({ type: "string" }),
        quantity: f({ type: "number" }), qtyToReceive: f({ type: "number" }), qtyOutstanding: f({ type: "number" }), qtyReceived: f({ type: "number" }),
        sourceNo: f({ type: "string" }), sourceLineNo: f({ type: "number" }),
      },
    },
  },
  "putaways.list": {
    api: "custom", entity: "putaways", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["putaways"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 100, defaultTop: 50,
      defaultSelect: ["id", "number", "type", "locationCode", "assignedUserId"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        number: f({ type: "string", filterable: true, sortable: true, ops: ["eq"] }),
        type: f({ type: "string" }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        assignedUserId: f({ type: "string" }),
      },
    },
  },
  "putawayLines.list": {
    api: "custom", entity: "putawayLines", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["putaways"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 200, defaultTop: 100,
      defaultSelect: ["id", "activityNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "binCode", "zoneCode", "quantity", "qtyOutstanding", "qtyToHandle", "sourceNo", "whseDocumentNo"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        activityNo: f({ type: "string", filterable: true, ops: ["eq"] }),
        lineNo: f({ type: "number", sortable: true }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        itemNo: f({ type: "string" }), description: f({ type: "string" }), unitOfMeasureCode: f({ type: "string" }),
        binCode: f({ type: "string" }), zoneCode: f({ type: "string" }),
        quantity: f({ type: "number" }), qtyOutstanding: f({ type: "number" }), qtyToHandle: f({ type: "number" }),
        sourceNo: f({ type: "string" }), whseDocumentNo: f({ type: "string" }),
      },
    },
  },
  "purchaseOrders.list": {
    api: "custom", entity: "purchaseOrders", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["purchaseOrders"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 100, defaultTop: 50,
      defaultSelect: ["id", "number", "locationCode", "vendorNo", "vendorName", "status", "expectedReceiptDate"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        number: f({ type: "string", filterable: true, sortable: true, ops: ["eq"] }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        vendorNo: f({ type: "string" }), vendorName: f({ type: "string" }),
        status: f({ type: "enum", values: ["Open", "Released", "Pending Approval", "Pending Prepayment"], filterable: true, ops: ["eq", "in"] }),
        expectedReceiptDate: f({ type: "date", sortable: true }),
      },
    },
  },
  "purchaseLines.list": {
    api: "custom", entity: "purchaseOrderLines", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["purchaseOrders"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 200, defaultTop: 100,
      defaultSelect: ["id", "documentNo", "lineNo", "locationCode", "itemNo", "description", "unitOfMeasureCode", "quantity", "qtyToReceive", "quantityReceived", "outstandingQuantity"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        documentNo: f({ type: "string", filterable: true, ops: ["eq"] }),
        lineNo: f({ type: "number", sortable: true }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        itemNo: f({ type: "string" }), description: f({ type: "string" }), unitOfMeasureCode: f({ type: "string" }),
        quantity: f({ type: "number" }), qtyToReceive: f({ type: "number" }), quantityReceived: f({ type: "number" }), outstandingQuantity: f({ type: "number" }),
      },
    },
  },
  "locationSetup.list": {
    api: "custom", entity: "locationSetups", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "reference", tags: ["locations"],
    scope: warehouseScope("code"),
    query: {
      maxTop: 50, defaultTop: 10,
      defaultSelect: ["id", "code", "name", "requireReceive", "requirePutaway", "requirePick", "requireShipment", "binMandatory", "directedPutawayAndPick"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        code: f({ type: "string", filterable: true, sortable: true, ops: ["eq", "in"] }),
        name: f({ type: "string" }),
        requireReceive: f({ type: "boolean" }), requirePutaway: f({ type: "boolean" }), requirePick: f({ type: "boolean" }),
        requireShipment: f({ type: "boolean" }), binMandatory: f({ type: "boolean" }), directedPutawayAndPick: f({ type: "boolean" }),
      },
    },
  },
  "bins.list": {
    api: "custom", entity: "bins", method: "GET", lane: "interactive",
    permission: perm("bins", "view"), cache: "reference", tags: ["bins"],
    scope: warehouseScope("locationCode"),
    query: {
      maxTop: 50, defaultTop: 20, defaultSelect: ["id", "locationCode", "code", "description", "zoneCode"],
      fields: {
        id: f({ type: "guid", filterable: true }),
        locationCode: f({ type: "string", filterable: true, ops: ["eq", "in"] }),
        code: f({ type: "string", filterable: true, sortable: true, ops: ["eq", "startswith"] }),
        description: f({ type: "string" }),
        zoneCode: f({ type: "string", filterable: true, ops: ["eq"] }),
      },
    },
  },

  /* ------------------------------------------------------------- transactions */
  "transactions.list": {
    api: "custom", entity: "transactions", method: "GET", lane: "interactive",
    permission: perm("transactions", "view"), cache: "none", tags: ["transactions"],
    scope: warehouseScope("locationCode"),
    query: TRANSACTION_QUERY,
  },
  // Same entity as transactions.list but cached briefly: dashboards tolerate ~30s staleness, work queues do not.
  "transactions.summary": {
    api: "custom", entity: "transactions", method: "GET", lane: "background",
    permission: perm("dashboard", "view"), cache: "dashboard", tags: ["transactions"],
    scope: warehouseScope("locationCode"),
    query: TRANSACTION_QUERY,
  },
  "transactions.submit": {
    api: "custom", entity: "transactions", method: "POST", lane: "write",
    permission: perm("transactions", "submit"), invalidates: ["transactions"], idempotent: true,
  },

  /* -------------------------------------------- authentication (system only) */
  "authUsers.get": {
    api: "custom", entity: "authUsers", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 2, defaultTop: 1,
      defaultSelect: ["id", "userId", "displayName", "status", "mustChangePassword", "failedLoginAttempts", "lockedUntil", "lastLoginAt", "defaultLocationCode"],
      fields: {
        id: f({ type: "guid" }),
        userId: f({ type: "string", filterable: true, ops: ["eq"] }),
        displayName: f({ type: "string" }),
        status: f({ type: "enum", values: ["Active", "Suspended", "Deactivated"] }),
        mustChangePassword: f({ type: "boolean" }),
        failedLoginAttempts: f({ type: "number" }),
        lockedUntil: f({ type: "date" }),
        lastLoginAt: f({ type: "date" }),
        defaultLocationCode: f({ type: "string" }),
      },
    },
  },
  // Plaintext credentials travel only from the WMS server to the BC codeunit over HTTPS.
  // BC verifies them against a salted iterative hash and never returns the stored hash.
  "auth.login": {
    method: "ACTION", service: "VWMSAuth", action: "Login", lane: "interactive",
    permission: SYSTEM_PERMISSION, params: { userId: "string", password: "string" }, returns: "json-text",
  },
  "userWarehouses.list": {
    api: "custom", entity: "userWarehouses", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 100, defaultTop: 100, defaultSelect: ["locationCode", "binFilter"],
      fields: {
        userId: f({ type: "string", filterable: true, ops: ["eq"] }),
        locationCode: f({ type: "string" }),
        binFilter: f({ type: "string" }),
      },
    },
  },
  "userPermissions.list": {
    api: "custom", entity: "userPermissions", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 200, defaultTop: 200, defaultSelect: ["permissionCode"],
      fields: {
        userId: f({ type: "string", filterable: true, ops: ["eq"] }),
        permissionCode: f({ type: "string" }),
      },
    },
  },
  "userRoles.list": {
    api: "custom", entity: "userRoles", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 1000, defaultTop: 1000, defaultSelect: ["userId", "roleCode"],
      fields: {
        userId: f({ type: "string", filterable: true, ops: ["eq"] }),
        roleCode: f({ type: "string", filterable: true, ops: ["eq"] }),
      },
    },
  },
  "roles.list": {
    api: "custom", entity: "roles", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 1000, defaultTop: 1000, defaultSelect: ["roleCode", "roleName", "enabled"],
      fields: {
        roleCode: f({ type: "string", filterable: true, ops: ["eq"] }),
        roleName: f({ type: "string" }),
        description: f({ type: "string" }),
        enabled: f({ type: "boolean", filterable: true, ops: ["eq"] }),
      },
    },
  },
  "rolePermissions.list": {
    api: "custom", entity: "rolePermissions", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 1000, defaultTop: 1000, defaultSelect: ["roleCode", "permissionCode"],
      fields: {
        roleCode: f({ type: "string", filterable: true, ops: ["eq"] }),
        permissionCode: f({ type: "string" }),
      },
    },
  },
  "sessions.get": {
    api: "custom", entity: "sessions", method: "GET", lane: "interactive",
    permission: SYSTEM_PERMISSION, cache: "none", tags: [],
    query: {
      maxTop: 50, defaultTop: 1,
      defaultSelect: ["id", "sessionHash", "userId", "createdAt", "lastSeenAt", "ipHash", "userAgent", "revoked"],
      fields: {
        id: f({ type: "guid" }),
        sessionHash: f({ type: "string", filterable: true, ops: ["eq"] }),
        userId: f({ type: "string", filterable: true, ops: ["eq"] }),
        createdAt: f({ type: "date" }),
        lastSeenAt: f({ type: "date" }),
        ipHash: f({ type: "string" }),
        userAgent: f({ type: "string" }),
        revoked: f({ type: "boolean", filterable: true }),
      },
    },
  },
  "sessions.create": {
    api: "custom", entity: "sessions", method: "POST", lane: "write",
    permission: SYSTEM_PERMISSION, invalidates: [], idempotent: false,
  },
  "sessions.update": {
    api: "custom", entity: "sessions", method: "PATCH", lane: "write",
    permission: SYSTEM_PERMISSION, invalidates: [],
    fields: { lastSeenAt: "string", revoked: "boolean", revokedBy: "string" },
  },

  /* ------------------------------------------------- worker actions (system) */
  "worker.claimBatch": {
    method: "ACTION", service: "VWMSWorker", action: "ClaimBatch", lane: "background",
    permission: SYSTEM_PERMISSION, params: { workerId: "string", leaseSeconds: "number", maxCount: "number" }, returns: "json-text",
  },
  "worker.queueState": {
    method: "ACTION", service: "VWMSWorker", action: "QueueState", lane: "background",
    permission: SYSTEM_PERMISSION, params: {}, returns: "json-text",
  },
  "worker.process": {
    method: "ACTION", service: "VWMSWorker", action: "ProcessTransaction", lane: "background",
    permission: SYSTEM_PERMISSION, params: { transactionId: "string", workerId: "string" }, returns: "json-text",
  },
  "worker.heartbeat": {
    method: "ACTION", service: "VWMSWorker", action: "Heartbeat", lane: "background",
    permission: SYSTEM_PERMISSION, params: { transactionId: "string", workerId: "string", leaseSeconds: "number" }, returns: "boolean",
  },
  "worker.cancel": {
    method: "ACTION", service: "VWMSWorker", action: "CancelTransaction", lane: "write",
    permission: perm("transactions", "cancel"), params: { transactionId: "string", userId: "string" }, returns: "text",
  },
  "worker.resolve": {
    method: "ACTION", service: "VWMSWorker", action: "ResolveTransaction", lane: "write",
    permission: perm("administration", "administer"),
    params: { transactionId: "string", action: "string", userId: "string", resultDocumentNo: "string", note: "string" }, returns: "text",
  },
} as const satisfies Record<string, Operation>;

export type OperationKey = keyof typeof OPERATIONS;

export function getOperation(key: string): Operation | undefined {
  return Object.prototype.hasOwnProperty.call(OPERATIONS, key) ? (OPERATIONS as Record<string, Operation>)[key] : undefined;
}

function root(cfg: WmsConfig): string {
  return `${cfg.apiBaseUrl.replace(/\/+$/, "")}/${cfg.tenantId}/${cfg.envName}`;
}

/** Entity-set URL for read/create/patch operations. Host, tenant, env and company come from validated config only. */
export function buildOperationUrl(cfg: WmsConfig, op: ReadOp | CreateOp | PatchOp): string {
  const company = `companies(${cfg.companyId})`;
  const base = op.api === "standard" ? `${root(cfg)}/api/v2.0/${company}` : `${root(cfg)}/api/velvotix/wms/v1.0/${company}`;
  return `${base}/${op.entity}`;
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function buildEntityUrl(cfg: WmsConfig, op: PatchOp, id: string): string {
  if (!GUID_RE.test(id)) throw new Error("Invalid record id");
  return `${buildOperationUrl(cfg, op)}(${id.toLowerCase()})`;
}

/** Unbound OData action on a published web service. Live mode uses the company GUID. */
export function buildActionUrl(cfg: WmsConfig, op: ActionOp): string {
  // BC accepts the company GUID in braces for ODataV4 codeunit actions.
  // In mock mode retain the display name expected by the local mock transport.
  const company = cfg.mode === "live" ? `{${cfg.companyId}}` : encodeURIComponent(cfg.companyName);
  return `${root(cfg)}/ODataV4/${op.service}_${op.action}?company=${company}`;
}

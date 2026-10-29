import "server-only";
import { randomUUID } from "node:crypto";
import { decodeODataEnum, encodeODataEnum } from "./odata-enum";
import { verifyPassword } from "@/lib/security/password";

/**
 * In-memory Business Central stand-in for development and automated tests. It mimics the
 * behaviours the real AL extension has (and which the web tier must handle): upper-cased Code
 * fields, OData-escaped enum names, duplicate idempotency keys rejected with VWMS_DUPLICATE,
 * lease-based claiming and the worker actions. Never used in production (config rejects it).
 */

type Row = Record<string, string | number | boolean | null>;
const E = encodeODataEnum;

const ITEMS: Row[] = [
  { id: "11111111-1111-4111-8111-111111111101", number: "1000", displayName: "Bicycle", baseUnitOfMeasureCode: "PCS", blocked: false, itemCategoryCode: "BIKES", inventory: 42, gtin: "5901234123457" },
  { id: "11111111-1111-4111-8111-111111111102", number: "1100", displayName: "Front Wheel", baseUnitOfMeasureCode: "PCS", blocked: false, itemCategoryCode: "PARTS", inventory: 120, gtin: "" },
  { id: "11111111-1111-4111-8111-111111111103", number: "1200", displayName: "Frame Kit", baseUnitOfMeasureCode: "PCS", blocked: true, itemCategoryCode: "PARTS", inventory: 0, gtin: "" },
];
const LOCATIONS: Row[] = [
  { id: "22222222-2222-4222-8222-222222222201", code: "MAIN", displayName: "Main Warehouse" },
  { id: "22222222-2222-4222-8222-222222222202", code: "EAST", displayName: "East DC" },
];
const BINS: Row[] = [
  { id: "44444444-4444-4444-8444-444444444401", locationCode: "MAIN", code: "A-01", description: "Aisle A bin 1", zoneCode: "PICK" },
  { id: "44444444-4444-4444-8444-444444444402", locationCode: "MAIN", code: "A-02", description: "Aisle A bin 2", zoneCode: "PICK" },
  { id: "44444444-4444-4444-8444-444444444403", locationCode: "EAST", code: "B-01", description: "East bin 1", zoneCode: "PICK" },
];

const WAREHOUSE_SHIPMENTS: Row[] = [
  { id: "33333333-3333-4333-8333-333333333301", number: "WS-1001", locationCode: "MAIN", shipmentDate: new Date().toISOString().slice(0, 10), assignedUserId: "PICKER", documentStatus: " ", status: "Released", externalDocumentNo: "SO-10001" },
  { id: "33333333-3333-4333-8333-333333333302", number: "WS-1002", locationCode: "MAIN", shipmentDate: new Date().toISOString().slice(0, 10), assignedUserId: "PICKER", documentStatus: "Partially Picked", status: "Released", externalDocumentNo: "SO-10002" },
  { id: "33333333-3333-4333-8333-333333333303", number: "WS-2001", locationCode: "EAST", shipmentDate: new Date().toISOString().slice(0, 10), assignedUserId: "SHIPPER", documentStatus: "Completely Picked", status: "Released", externalDocumentNo: "SO-20001" },
];
const WAREHOUSE_SHIPMENT_LINES: Row[] = [
  { id: "44444444-4444-4444-8444-444444444401", documentNo: "WS-1001", lineNo: 10000, locationCode: "MAIN", itemNo: "1000", description: "Bicycle", quantity: 4, qtyToShip: 4, qtyOutstanding: 4, qtyPicked: 0, qtyShipped: 0, pickQty: 0, qtyPacked: 0, unitOfMeasureCode: "PCS", binCode: "PICK-01", sourceNo: "SO-10001", sourceLineNo: 10000, status: " " },
  { id: "44444444-4444-4444-8444-444444444402", documentNo: "WS-1001", lineNo: 20000, locationCode: "MAIN", itemNo: "1100", description: "Front Wheel", quantity: 8, qtyToShip: 8, qtyOutstanding: 8, qtyPicked: 0, qtyShipped: 0, pickQty: 0, qtyPacked: 0, unitOfMeasureCode: "PCS", binCode: "PICK-02", sourceNo: "SO-10001", sourceLineNo: 20000, status: " " },
  { id: "44444444-4444-4444-8444-444444444403", documentNo: "WS-1002", lineNo: 10000, locationCode: "MAIN", itemNo: "1100", description: "Front Wheel", quantity: 3, qtyToShip: 3, qtyOutstanding: 3, qtyPicked: 1, qtyShipped: 0, pickQty: 0, qtyPacked: 0, unitOfMeasureCode: "PCS", binCode: "PICK-02", sourceNo: "SO-10002", sourceLineNo: 10000, status: "Partially Picked" },
  { id: "44444444-4444-4444-8444-444444444404", documentNo: "WS-2001", lineNo: 10000, locationCode: "EAST", itemNo: "1000", description: "Bicycle", quantity: 2, qtyToShip: 2, qtyOutstanding: 2, qtyPicked: 2, qtyShipped: 0, pickQty: 0, qtyPacked: 0, unitOfMeasureCode: "PCS", binCode: "PICK-01", sourceNo: "SO-20001", sourceLineNo: 10000, status: "Completely Picked" },
];

function atom(row: Row, a: string): boolean {
  let m = /^(contains|startswith)\((\w+),'((?:[^']|'')*)'\)$/.exec(a);
  if (m) {
    const v = String(row[m[2]!] ?? "").toLowerCase();
    const needle = m[3]!.replace(/''/g, "'").toLowerCase();
    return m[1] === "contains" ? v.includes(needle) : v.startsWith(needle);
  }
  m = /^(\w+) (eq|ne) (?:'((?:[^']|'')*)'|(true|false|[\d.]+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}))$/.exec(a);
  if (m) {
    const actual = String(row[m[1]!] ?? "").toLowerCase(); // BC string comparison is case-insensitive
    const expected = (m[3] !== undefined ? m[3].replace(/''/g, "'") : m[4]!).toLowerCase();
    return m[2] === "eq" ? actual === expected : actual !== expected;
  }
  return false;
}

function matches(row: Row, filter: string | null): boolean {
  if (!filter) return true;
  return filter.split(/\)\s+and\s+\(/).every((grp) =>
    grp.replace(/^\(/, "").replace(/\)$/, "").split(/\s+or\s+/).some((a) => atom(row, a.trim())),
  );
}

export type MockProcessOutcome = "complete" | "transient" | "permanent";

export interface MockUserSeed {
  userId: string;
  displayName?: string;
  status?: "Active" | "Suspended" | "Deactivated";
  passwordHash?: string;
  warehouses?: string[];
  permissions?: string[];
}

export class MockBc {
  private transactions = new Map<string, Row>();
  private authUsers = new Map<string, Row>();
  private userWarehouses: Row[] = [];
  private userPermissions: Row[] = [];
  private userRoles: Row[] = [];
  private roles: Row[] = [];
  private rolePermissions: Row[] = [];
  private sessions = new Map<string, Row>();

  /* Test hooks */
  failNext: { status: number; times: number } | undefined;
  dropResponseOnce = false;
  requestCount = 0;
  enforceUsers = false;
  processOutcome: (row: Row) => MockProcessOutcome = (row) => (row.operationType === E("Diagnostic") ? "complete" : "permanent");
  lastRequest: { method: string; url: string; body?: string } | undefined;
  /** Request paths only; intentionally never records bodies (which may include passwords). */
  readonly seenPaths: string[] = [];

  seedUser(u: MockUserSeed): void {
    const id = u.userId.toUpperCase();
    this.authUsers.set(id, {
      id: randomUUID(), userId: id, displayName: u.displayName ?? id, status: E(u.status ?? "Active"),
      passwordHash: u.passwordHash ?? "", mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null,
    });
    for (const w of u.warehouses ?? []) this.userWarehouses.push({ userId: id, locationCode: w.toUpperCase(), binFilter: "" });
    for (const p of u.permissions ?? []) this.userPermissions.push({ userId: id, permissionCode: p.toUpperCase() });
  }

  seedRole(roleCode: string, roleName: string, permissionCodes: string[], enabled = true): void {
    const code = roleCode.toUpperCase();
    this.roles = this.roles.filter((r) => r.roleCode !== code);
    this.roles.push({ id: randomUUID(), roleCode: code, roleName, description: "", enabled });
    this.rolePermissions = this.rolePermissions.filter((r) => r.roleCode !== code);
    for (const p of permissionCodes) this.rolePermissions.push({ roleCode: code, permissionCode: p.toUpperCase() });
  }

  assignRole(userId: string, roleCode: string): void {
    this.userRoles.push({ userId: userId.toUpperCase(), roleCode: roleCode.toUpperCase() });
  }

  transactionRows(): Row[] {
    return [...this.transactions.values()];
  }

  async handle(method: string, url: URL, body?: string): Promise<Response> {
    this.requestCount += 1;
    const isAuthLogin = /\/ODataV4\/VWMSAuth_Login$/.test(url.pathname);
    // Test diagnostics must not retain plaintext passwords, even in mock mode.
    this.lastRequest = { method, url: url.toString(), body: isAuthLogin ? "[REDACTED]" : body };
    this.seenPaths.push(url.pathname);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    const odataError = (status: number, message: string) => json({ error: { code: "Application_General", message } }, status);

    if (this.failNext && this.failNext.times > 0) {
      this.failNext.times -= 1;
      return new Response("{}", { status: this.failNext.status, headers: { "Retry-After": "0" } });
    }

    /* BC ODataV4 codeunit endpoints: /ODataV4/VWMSAuth_Login and VWMSWorker_* */
    const authAction = /\/ODataV4\/VWMSAuth_(\w+)$/.exec(url.pathname);
    if (authAction && method === "POST" && authAction[1] === "Login") {
      const p = JSON.parse(body ?? "{}") as Record<string, unknown>;
      const userId = String(p.userId ?? "").trim().toUpperCase();
      const password = String(p.password ?? "");
      const user = this.authUsers.get(userId);
      const locked = Boolean(user?.lockedUntil && Date.parse(String(user.lockedUntil)) > Date.now());
      const valid = await verifyPassword(password, user && !locked && user.status === E("Active") ? String(user.passwordHash ?? "") : undefined);
      if (user && valid && !locked && user.status === E("Active")) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.lastLoginAt = new Date().toISOString();
        return json({ value: JSON.stringify({ success: true, userId, displayName: String(user.displayName ?? userId), status: "Active", mustChangePassword: Boolean(user.mustChangePassword) }) });
      }
      if (user && !locked && user.status === E("Active")) {
        user.failedLoginAttempts = Number(user.failedLoginAttempts ?? 0) + 1;
        if (Number(user.failedLoginAttempts) >= 5) user.lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
      }
      return json({ value: JSON.stringify({ success: false, message: "Invalid user ID or password" }) });
    }
    const act = /\/ODataV4\/VWMSWorker_(\w+)$/.exec(url.pathname);
    if (act && method === "POST") return this.action(act[1]!, JSON.parse(body ?? "{}") as Record<string, unknown>, json, odataError);

    const seg = url.pathname.split("/").pop() ?? "";
    const m = /^(\w+?)(?:\(([0-9a-fA-F-]{36})\))?$/.exec(seg);
    const entity = m?.[1] ?? "";
    const recId = m?.[2];

    const table = (): Row[] | undefined => {
      switch (entity) {
        case "items": return ITEMS;
        case "locations": return LOCATIONS;
        case "warehouseShipments": return WAREHOUSE_SHIPMENTS;
        case "warehouseShipmentLines": return WAREHOUSE_SHIPMENT_LINES;
        case "bins": return BINS;
        case "transactions": return [...this.transactions.values()];
        case "authUsers": return [...this.authUsers.values()];
        case "userWarehouses": return this.userWarehouses;
        case "userPermissions": return this.userPermissions;
        case "userRoles": return this.userRoles;
        case "roles": return this.roles;
        case "rolePermissions": return this.rolePermissions;
        case "sessions": return [...this.sessions.values()];
        default: return undefined;
      }
    };

    if (method === "GET") {
      const t = table();
      if (!t) return odataError(404, "Resource not found");
      const top = Number(url.searchParams.get("$top") ?? 50);
      return json({ value: t.filter((r) => matches(r, url.searchParams.get("$filter"))).slice(0, top) });
    }

    if (method === "PATCH" && recId) {
      const target = (table() ?? []).find((r) => r.id === recId.toLowerCase());
      if (!target) return odataError(404, "Resource not found");
      Object.assign(target, JSON.parse(body ?? "{}"));
      return json(target);
    }

    if (method === "POST" && entity === "sessions") {
      const data = JSON.parse(body ?? "{}") as Row;
      const row: Row = { ...data, sessionHash: String(data.sessionHash ?? "").toUpperCase(), userId: String(data.userId ?? "").toUpperCase(), id: randomUUID(), revoked: false };
      this.sessions.set(String(row.id), row);
      return json(row, 201);
    }

    if (method === "POST" && entity === "transactions") {
      const data = JSON.parse(body ?? "{}") as Row;
      const key = String(data.idempotencyKey ?? "").toUpperCase();
      if (key.length < 16) return odataError(400, "The idempotency key must be 16 to 64 characters.");
      if (this.transactions.has(key)) return odataError(400, "VWMS_DUPLICATE: a transaction with this idempotency key already exists.");
      const userId = String(data.wmsUserId ?? "").toUpperCase();
      const loc = String(data.locationCode ?? "").toUpperCase();
      if (this.enforceUsers) {
        const u = this.authUsers.get(userId);
        if (!u) return odataError(400, `WMS user ${userId} does not exist.`);
        if (u.status !== E("Active")) return odataError(400, `WMS user ${userId} is not active.`);
        if (!this.userWarehouses.some((w) => w.userId === userId && w.locationCode === loc)) return odataError(400, `WMS user ${userId} is not assigned to location ${loc}.`);
        if (!this.userPermissions.some((p) => p.userId === userId && p.permissionCode === "TRANSACTIONS:SUBMIT")) return odataError(400, `WMS user ${userId} does not have permission transactions:submit.`);
      }
      const row: Row = {
        id: randomUUID(), idempotencyKey: key, operationType: String(data.operationType ?? E("Diagnostic")), status: E("Submitted"), payloadHash: String(data.payloadHash ?? "").toUpperCase(), sourceDocumentNo: String(data.sourceDocumentNo ?? ""), destinationLocationCode: String(data.destinationLocationCode ?? ""),
        locationCode: loc, wmsUserId: userId, attemptCount: 0, errorClass: E("None"), errorCode: "", errorMessage: "", resultDocumentNo: "",
        requestedAt: new Date().toISOString(), completedAt: null, leaseOwner: "", leaseExpiresAt: 0, processStarted: false, retryAfter: 0,
      };
      this.transactions.set(key, row);
      if (this.dropResponseOnce) {
        this.dropResponseOnce = false; // BC applied the write, but the client never sees the response.
        throw new TypeError("fetch failed");
      }
      return json(row, 201);
    }
    return odataError(400, "Unsupported request");
  }

  private find(id: string): Row | undefined {
    return [...this.transactions.values()].find((r) => r.id === id.toLowerCase());
  }

  private action(
    name: string,
    p: Record<string, unknown>,
    json: (v: unknown, s?: number) => Response,
    err: (s: number, m: string) => Response,
  ): Response {
    const now = Date.now();
    const text = (v: unknown) => json({ value: JSON.stringify(v) });
    switch (name) {
      case "ClaimBatch": {
        const max = Math.min(Number(p.maxCount ?? 1) || 1, 20);
        const claimed: Row[] = [];
        for (const r of this.transactions.values()) {
          if (claimed.length >= max) break;
          const claimable = r.status === E("Submitted") || r.status === E("Queued");
          if (claimable && Number(r.retryAfter) <= now) {
            Object.assign(r, { status: E("Processing"), leaseOwner: String(p.workerId), leaseExpiresAt: now + Number(p.leaseSeconds ?? 120) * 1000, attemptCount: Number(r.attemptCount) + 1, processStarted: false });
            claimed.push(r);
          }
        }
        return text(claimed.map((r) => ({ id: r.id, operationType: decodeODataEnum(String(r.operationType)), attemptCount: r.attemptCount })));
      }
      case "ProcessTransaction": {
        const r = this.find(String(p.transactionId));
        if (!r) return err(400, `Transaction ${String(p.transactionId)} was not found.`);
        const out = (outcome: string) => text({ outcome, id: r.id, status: decodeODataEnum(String(r.status)), errorClass: decodeODataEnum(String(r.errorClass)), errorCode: r.errorCode, resultDocumentNo: r.resultDocumentNo, attemptCount: r.attemptCount });
        if (r.status !== E("Processing") || r.leaseOwner !== String(p.workerId) || Number(r.leaseExpiresAt) < now) return out("not_owner");
        r.processStarted = true;
        const result = this.processOutcome(r);
        r.leaseOwner = ""; r.leaseExpiresAt = 0;
        if (result === "complete") Object.assign(r, { status: E("Completed"), resultDocumentNo: `${r.operationType === E("Receipt") ? "RCPT" : r.operationType === E("Diagnostic") ? "DIAG" : "OP"}-${100 + [...this.transactions.values()].indexOf(r)}`, completedAt: new Date().toISOString() });
        else if (result === "transient") Object.assign(r, { status: E("Queued"), errorClass: E("Transient"), errorCode: "TRANSIENT_ERROR", retryAfter: now });
        else Object.assign(r, { status: E("Failed"), errorClass: E("Permanent"), errorCode: "OPERATION_NOT_IMPLEMENTED" });
        return out("processed");
      }
      case "Heartbeat": {
        const r = this.find(String(p.transactionId));
        if (!r || r.status !== E("Processing") || r.leaseOwner !== String(p.workerId)) return json({ value: false });
        r.leaseExpiresAt = now + Number(p.leaseSeconds ?? 120) * 1000;
        return json({ value: true });
      }
      case "CancelTransaction": {
        const r = this.find(String(p.transactionId));
        if (!r) return err(400, "Transaction not found.");
        if (![E("Submitted"), E("Queued")].includes(String(r.status))) return err(400, `A transaction in status ${decodeODataEnum(String(r.status))} cannot be cancelled.`);
        r.status = E("Cancelled");
        return json({ value: "Cancelled" });
      }
      default:
        return err(404, "Unknown action");
    }
  }
}

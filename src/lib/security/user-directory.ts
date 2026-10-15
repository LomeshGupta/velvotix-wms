import "server-only";
import { hashPassword, verifyPassword } from "./password";

export type UserStatus = "Active" | "Suspended" | "Deactivated";

/** Everything the request path needs. Deliberately contains NO credential material. */
export interface UserProfile {
  userId: string;
  displayName: string;
  /** Assigned enabled WMS role names/codes from BC, or the corresponding mock role in dev. */
  roles?: readonly string[];
  status: UserStatus;
  /** Lower-case "module:action" strings. */
  permissions: readonly string[];
  warehouseCodes: readonly string[];
  mustChangePassword: boolean;
}

/** Login-time view. The hash exists only in this type and is never cached or serialised. */
export interface LoginRecord extends UserProfile {
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: number | undefined;
}

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/**
 * Source of WMS users. Live mode uses BcUserDirectory (VWMS User tables in Business Central);
 * mock mode uses MockUserDirectory.
 */
export interface UserDirectory {
  /** Verifies credentials using the authoritative store (Business Central in live mode). */
  authenticate(userId: string, password: string): Promise<UserProfile | undefined>;
  /** Short-lived cache allowed (bounded staleness for suspension/permission changes). Never includes a password hash. */
  findProfile(userId: string): Promise<UserProfile | undefined>;
}

/**
 * Development/test directory. Development-only mock admin password defaults to `MockAdmin!2026` when mock mode is enabled outside production.
 * Override it with WMS_MOCK_ADMIN_PASSWORD. Mock mode is refused in production.
 */
export class MockUserDirectory implements UserDirectory {
  private readonly records = new Map<string, Promise<LoginRecord>>();

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async findForLogin(userId: string): Promise<LoginRecord | undefined> {
    if (this.env.NODE_ENV === "production" || (this.env.WMS_BC_MODE ?? "mock") !== "mock") return undefined;
    const id = userId.trim().toUpperCase();
    const commonRead = ["dashboard:view", "items:view", "locations:view", "transactions:view", "inventory:view"];
    const allOperations = [
      "receiving:submit", "putaway:submit", "movements:submit", "picking:submit", "packing:submit",
      "shipping:submit", "cyclecounts:submit", "inventory:adjust", "returns:submit", "quality:submit",
    ];
    const roleUsers: Record<string, { name: string; roleName: string; password: string; permissions: string[]; warehouses: string[] }> = {
      ADMIN: { name: "Mock Administrator", roleName: "WMS Administrator", password: this.env.WMS_MOCK_ADMIN_PASSWORD || "MockAdmin!2026", permissions: [...commonRead, ...allOperations, "transactions:submit", "administration:administer"], warehouses: ["MAIN", "EAST", "WEST"] },
      MANAGER: { name: "Warehouse Manager", roleName: "Warehouse Manager", password: this.env.WMS_MOCK_MANAGER_PASSWORD || "Manager!2026", permissions: [...commonRead, ...allOperations, "transactions:submit", "administration:administer"], warehouses: ["MAIN", "EAST", "WEST"] },
      RECEIVER: { name: "Receiving Operator", roleName: "Receiving Operator", password: this.env.WMS_MOCK_OPERATOR_PASSWORD || "Operator!2026", permissions: [...commonRead, "transactions:submit", "receiving:submit", "putaway:submit"], warehouses: ["MAIN"] },
      PICKER: { name: "Picking Operator", roleName: "Picking Operator", password: this.env.WMS_MOCK_OPERATOR_PASSWORD || "Operator!2026", permissions: [...commonRead, "transactions:submit", "picking:submit", "movements:submit"], warehouses: ["MAIN", "EAST"] },
      SHIPPER: { name: "Shipping Operator", roleName: "Shipping Operator", password: this.env.WMS_MOCK_OPERATOR_PASSWORD || "Operator!2026", permissions: [...commonRead, "transactions:submit", "packing:submit", "shipping:submit"], warehouses: ["EAST"] },
      AUDITOR: { name: "Read-only Auditor", roleName: "WMS Auditor", password: this.env.WMS_MOCK_AUDITOR_PASSWORD || "Auditor!2026", permissions: commonRead, warehouses: ["MAIN", "EAST"] },
    };
    const seed = roleUsers[id];
    if (!seed) return undefined;
    let record = this.records.get(id);
    if (!record) {
      record = hashPassword(seed.password).then((passwordHash) => ({
        userId: id, displayName: seed.name, roles: [seed.roleName], status: "Active" as const, passwordHash,
        permissions: seed.permissions, warehouseCodes: seed.warehouses, mustChangePassword: false,
        failedLoginAttempts: 0, lockedUntil: undefined,
      }));
      this.records.set(id, record);
    }
    return record;
  }

  async authenticate(userId: string, password: string): Promise<UserProfile | undefined> {
    const user = await this.findForLogin(userId);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > Date.now());
    const valid = await verifyPassword(password, user && !locked && user.status === "Active" ? user.passwordHash : undefined);
    if (!user || !valid || locked || user.status !== "Active") {
      if (user && !locked) await this.recordLogin(user.userId, false);
      return undefined;
    }
    await this.recordLogin(user.userId, true);
    const { passwordHash: _hash, failedLoginAttempts: _failed, lockedUntil: _locked, ...profile } = user;
    void _hash; void _failed; void _locked;
    return profile;
  }

  async findProfile(userId: string): Promise<UserProfile | undefined> {
    const r = await this.findForLogin(userId);
    if (!r) return undefined;
    const { passwordHash: _h, failedLoginAttempts: _f, lockedUntil: _l, ...profile } = r;
    void _h; void _f; void _l;
    return profile;
  }

  async recordLogin(userId: string, success: boolean): Promise<void> {
    const current = await this.findForLogin(userId);
    if (!current) return;
    if (success) {
      current.failedLoginAttempts = 0;
      current.lockedUntil = undefined;
    } else {
      current.failedLoginAttempts += 1;
      if (current.failedLoginAttempts >= MAX_FAILED_LOGINS) current.lockedUntil = Date.now() + LOCK_MINUTES * 60_000;
    }
    this.records.set(current.userId, Promise.resolve(current));
  }
}

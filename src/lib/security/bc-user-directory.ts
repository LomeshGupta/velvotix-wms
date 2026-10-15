import "server-only";
import { z } from "zod";
import type { BcGateway } from "@/lib/business-central/client";
import { BC_GUID_RE } from "@/lib/business-central/guid";
import type { Coordinator } from "@/lib/business-central/coordinator";
import { SYSTEM_PRINCIPAL } from "@/types/principal";
import type { UserDirectory, UserProfile, UserStatus } from "./user-directory";

const AuthUserRow = z.object({
  id: z.string().regex(BC_GUID_RE, "Invalid Business Central GUID"),
  userId: z.string(),
  displayName: z.string().default(""),
  status: z.enum(["Active", "Suspended", "Deactivated"]),
  mustChangePassword: z.boolean().default(false),
  failedLoginAttempts: z.number().default(0),
  lockedUntil: z.string().nullable().optional(),
});

// VWMSAuth.Login returns JSON serialized inside the OData `value` field.
const LoginResponse = z.object({
  success: z.boolean(),
  userId: z.string().optional(),
  displayName: z.string().optional().default(""),
  status: z.enum(["Active", "Suspended", "Deactivated"]).optional(),
  mustChangePassword: z.boolean().optional().default(false),
  message: z.string().optional(),
});

const sys = { principal: SYSTEM_PRINCIPAL };
const PROFILE_TTL_MS = 30_000;
// Versioned keys invalidate profiles/catalogs cached before login loaded real assignments.
const ROLE_CATALOG_CACHE_KEY = "wms:role-catalog:v3";

type RoleCatalog = {
  activeRoleCodes: string[];
  roleNames: Record<string, string>;
  permissionsByRole: Record<string, string[]>;
};

/** UserDirectory backed by the VWMS User tables, through the gateway's system-only operations. */
export class BcUserDirectory implements UserDirectory {
  constructor(
    private readonly gateway: BcGateway,
    private readonly coordinator: Coordinator,
  ) {}

  private async loadUser(userId: string) {
    const r = await this.gateway.read<Record<string, unknown>>(
      "authUsers.get",
      {
        select: [
          "id",
          "userId",
          "displayName",
          "status",
          "mustChangePassword",
          "failedLoginAttempts",
          "lockedUntil",
          "lastLoginAt",
          "defaultLocationCode",
        ],
        filter: [
          { field: "userId", op: "eq", value: userId.trim().toUpperCase() },
        ],
        top: 1,
      },
      sys,
    );
    const row = r.rows[0];
    return row ? AuthUserRow.parse(row) : undefined;
  }

  private async loadRoleCatalog(): Promise<RoleCatalog> {
    const cached = await this.coordinator
      .cacheGet(ROLE_CATALOG_CACHE_KEY)
      .catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as RoleCatalog;
      } catch {
        /* discard a malformed cache entry */
      }
    }

    const [roles, rolePermissions] = await Promise.all([
      this.gateway.read<{
        roleCode: string;
        roleName: string;
        enabled: boolean;
      }>("roles.list", {}, sys),
      this.gateway.read<{ roleCode: string; permissionCode: string }>(
        "rolePermissions.list",
        {},
        sys,
      ),
    ]);
    const enabledRoles = roles.rows.filter(
      (r) => r.enabled === true || String(r.enabled).toLowerCase() === "true",
    );
    const activeRoleCodes = enabledRoles.map((r) =>
      String(r.roleCode).toUpperCase(),
    );
    const roleNames = Object.fromEntries(
      enabledRoles.map((r) => [
        String(r.roleCode).toUpperCase(),
        String(r.roleName || r.roleCode),
      ]),
    );
    const active = new Set(activeRoleCodes);
    const permissionsByRole: Record<string, string[]> = {};
    for (const row of rolePermissions.rows) {
      const roleCode = String(row.roleCode).toUpperCase();
      if (!active.has(roleCode)) continue;
      (permissionsByRole[roleCode] ??= []).push(
        String(row.permissionCode).toLowerCase(),
      );
    }
    const catalog = { activeRoleCodes, roleNames, permissionsByRole };
    const ROLE_CATALOG_TTL_MS = 60_000;
    await this.coordinator
      .cacheSet(
        ROLE_CATALOG_CACHE_KEY,
        JSON.stringify(catalog),
        ROLE_CATALOG_TTL_MS,
      )
      .catch(() => undefined);
    return catalog;
  }

  private async loadAssignments(
    userId: string,
  ): Promise<{ warehouses: string[]; permissions: string[]; roles: string[] }> {
    const [w, direct, userRoles, catalog] = await Promise.all([
      this.gateway.read<{ locationCode: string }>(
        "userWarehouses.list",
        { filter: [{ field: "userId", op: "eq", value: userId }] },
        sys,
      ),
      this.gateway.read<{ permissionCode: string }>(
        "userPermissions.list",
        { filter: [{ field: "userId", op: "eq", value: userId }] },
        sys,
      ),
      this.gateway.read<{ roleCode: string }>(
        "userRoles.list",
        { filter: [{ field: "userId", op: "eq", value: userId }] },
        sys,
      ),
      this.loadRoleCatalog(),
    ]);
    const activeRoleCodes = new Set(catalog.activeRoleCodes);
    const assignedRoleCodes = new Set(
      userRoles.rows
        .map((r) => String(r.roleCode).toUpperCase())
        .filter((code) => activeRoleCodes.has(code)),
    );
    const permissions = new Set(
      direct.rows.map((r) => String(r.permissionCode).toLowerCase()),
    );
    // Only enabled roles assigned to this user can contribute effective permissions.
    for (const roleCode of assignedRoleCodes) {
      for (const permission of catalog.permissionsByRole[roleCode] ?? [])
        permissions.add(permission);
    }
    return {
      warehouses: w.rows.map((r) => String(r.locationCode).toUpperCase()),
      roles: [...assignedRoleCodes].map(
        (code) => catalog.roleNames[code] ?? code,
      ),
      // BC upper-cases Code fields; WMS permission strings are normalized to lower-case.
      permissions: [...permissions],
    };
  }

  /**
   * Login is verified by the VWMSAuth.Login codeunit. On success return the identity
   * from that response so the route can create the session immediately. Roles,
   * permissions and warehouse assignments are loaded separately by findProfile()
   * after sign-in, when the protected WMS area is opened.
   */
  async authenticate(
    userId: string,
    password: string,
  ): Promise<UserProfile | undefined> {
    const raw = await this.gateway.invoke<unknown>(
      "auth.login",
      { userId: userId.trim(), password },
      sys,
    );
    const parsed = LoginResponse.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.success !== true ||
      parsed.data.status !== "Active"
    ) {
      return undefined;
    }

    const result = parsed.data;
    const canonicalUserId = String(result.userId ?? userId)
      .trim()
      .toUpperCase();
    if (!canonicalUserId) return undefined;

    // The codeunit verifies credentials only. Load the WMS profile separately from the
    // published API pages so the session includes real roles, effective permissions,
    // and warehouse assignments before the client redirects to /dashboard.
    const profile = await this.findProfile(canonicalUserId);
    if (!profile || profile.status !== "Active") {
      throw new Error(
        "Business Central authenticated this user, but the WMS user profile could not be loaded. Check that the VWMS Auth Users API is published and the user exists in the VWMS User table.",
      );
    }

    return {
      ...profile,
      displayName:
        result.displayName?.trim() || profile.displayName || canonicalUserId,
      mustChangePassword:
        result.mustChangePassword ?? profile.mustChangePassword,
    };
  }

  async findProfile(userId: string): Promise<UserProfile | undefined> {
    const key = `prof:v3:${userId.toUpperCase()}`;
    const cached = await this.coordinator.cacheGet(key).catch(() => null);
    if (cached) return JSON.parse(cached) as UserProfile;

    const u = await this.loadUser(userId);
    if (!u) return undefined;
    const a = await this.loadAssignments(u.userId);
    const profile: UserProfile = {
      userId: u.userId,
      displayName: u.displayName,
      roles: a.roles,
      status: u.status as UserStatus,
      permissions: a.permissions,
      warehouseCodes: a.warehouses,
      mustChangePassword: u.mustChangePassword,
    };
    // Profile only: the password hash is never written to the cache.
    await this.coordinator
      .cacheSet(key, JSON.stringify(profile), PROFILE_TTL_MS)
      .catch(() => undefined);
    return profile;
  }
}

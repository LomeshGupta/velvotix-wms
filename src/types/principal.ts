/** Server-side identity resolved from a validated session. Never taken from the client. */
export type WmsAction =
  | "view"
  | "create"
  | "submit"
  | "process"
  | "approve"
  | "cancel"
  | "adjust"
  | "post"
  | "export"
  | "administer";

export type WmsModule =
  | "dashboard"
  | "items"
  | "locations"
  | "bins"
  | "receiving"
  | "putaway"
  | "movements"
  | "picking"
  | "packing"
  | "shipping"
  | "cyclecounts"
  | "returns"
  | "quality"
  | "transactions"
  | "administration";

export interface Principal {
  userId: string;
  displayName: string;
  /** Active role names/codes sourced from Business Central; never client-supplied. */
  roles?: readonly string[];
  /** Permission strings of the form "module:action". */
  permissions: readonly string[];
  /** Warehouse/location codes the user may touch. Empty means none (never "all"). */
  warehouseCodes: readonly string[];
  sessionId: string;
}

export const perm = (module: WmsModule, action: WmsAction): string => `${module}:${action}`;

/**
 * Internal identity for server-side infrastructure calls (authentication lookups, the worker).
 * It exists only inside the server process; no route ever derives a principal from client input.
 */
export const SYSTEM_PERMISSION = "system:internal";

export const SYSTEM_PRINCIPAL: Principal = {
  userId: "SYSTEM",
  displayName: "System",
  permissions: [SYSTEM_PERMISSION],
  warehouseCodes: [],
  sessionId: "system",
};

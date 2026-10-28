/**
 * Single source of truth for WMS permission codes on the web side. Mirrors the AL catalog
 * (VWMS Seed Defaults). Codes are lower-case here; Business Central stores them upper-case.
 */
export const ENFORCED_PERMISSIONS = [
  "dashboard:view", "items:view", "locations:view", "bins:view", "inventory:view",
  "transactions:view", "transactions:submit", "transactions:cancel",
  "receiving:submit", "putaway:submit", "movements:submit", "picking:submit", "packing:submit",
  "shipping:submit", "cyclecounts:submit", "inventory:adjust", "returns:submit", "quality:submit",
  "administration:administer",
] as const;

/** Reference/legacy codes that exist in the catalog (granting them to an administrator is harmless). */
export const REFERENCE_PERMISSIONS = [
  "operations:submit", "receiving:register", "putaway:register", "picking:register", "picking:view",
  "inventory:transfer", "returns:process", "returns:view", "cyclecounts:view", "cyclecounts:approve",
  "items:manage", "scanning:use", "labels:print", "integration:view", "integration:manage",
  "reports:view", "audit:view", "exceptions:manage", "roles:view", "roles:manage",
] as const;

export const ALL_WMS_PERMISSIONS: readonly string[] = [...ENFORCED_PERMISSIONS, ...REFERENCE_PERMISSIONS];

/** Existing assignments under an older name keep working: holding the key grants the value. */
export const PERMISSION_ALIASES: Record<string, string> = {
  "operations:submit": "transactions:submit",
  "receiving:register": "receiving:submit",
  "putaway:register": "putaway:submit",
  "picking:register": "picking:submit",
  "inventory:transfer": "movements:submit",
  "returns:process": "returns:submit",
};

/** Normalises case, applies aliases, and gives administrators every permission. */
export function expandPermissions(input: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    out.add(p);
    const canonical = PERMISSION_ALIASES[p];
    if (canonical) out.add(canonical);
  }
  if (out.has("administration:administer")) for (const p of ALL_WMS_PERMISSIONS) out.add(p);
  return [...out];
}

import { createHash, randomUUID } from "node:crypto";

const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;

export function newIdempotencyKey(): string {
  return randomUUID();
}

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

/**
 * Keys are namespaced per user and operation, so a client cannot collide with
 * (or probe for) another user's transaction by guessing a key.
 */
export function scopedIdempotencyKey(userId: string, operation: string, clientKey: string): string {
  return createHash("sha256").update(`${userId}\u0000${operation}\u0000${clientKey}`).digest("hex");
}

function canonicalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalise);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, val]) => [k, canonicalise(val)]),
    );
  }
  return v;
}

/** Detects "same key, different payload" so it can be rejected instead of silently reused. */
export function payloadFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalise(payload))).digest("hex");
}

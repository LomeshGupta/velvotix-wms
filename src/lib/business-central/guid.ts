/**
 * Business Central GUID fields use the standard 8-4-4-4-12 hexadecimal shape,
 * but are not guaranteed to follow RFC UUID version/variant bits. Do not use
 * Zod's .uuid() for GUIDs read from BC records or company IDs.
 */
export const BC_GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isBcGuid(value: unknown): value is string {
  return typeof value === "string" && BC_GUID_RE.test(value);
}

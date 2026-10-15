/**
 * Business Central exposes enum members through OData using escaped names: every character
 * outside [A-Za-z0-9_] becomes _xHHHH_ (for example "Requires Reconciliation" ->
 * "Requires_x0020_Reconciliation", "Put-away" -> "Put_x002D_away").
 */
export function encodeODataEnum(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

export function decodeODataEnum(value: string): string {
  return value.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

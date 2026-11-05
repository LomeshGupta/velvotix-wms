/**
 * What a line quantity means per operation:
 *  - "positive": move/receive/pick... a quantity above zero;
 *  - "signed":   Adjustment - positive adds stock, negative removes it, 0 does nothing;
 *  - "counted":  Cycle Count - the COUNTED quantity; 0 is a valid count (an empty bin).
 */
export type QuantityMode = "positive" | "signed" | "counted";

export const quantityMode = (operationType: string): QuantityMode =>
  operationType === "Adjustment" ? "signed" : operationType === "Cycle Count" ? "counted" : "positive";

export function quantityIsValid(mode: QuantityMode, quantity: number): boolean {
  if (!Number.isFinite(quantity)) return false;
  if (mode === "signed") return quantity !== 0;
  if (mode === "counted") return quantity >= 0;
  return quantity > 0;
}

/** Smallest value the − button may reach (undefined = no lower bound). */
export const quantityFloor = (mode: QuantityMode): number | undefined => (mode === "positive" ? 1 : mode === "counted" ? 0 : undefined);

export const quantityLabel = (operationType: string): string =>
  operationType === "Adjustment" ? "+/- Qty" : operationType === "Cycle Count" ? "Counted" : "Qty";

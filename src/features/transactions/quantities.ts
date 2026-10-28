type Line = { qtyToShip: number; qtyOutstanding: number; qtyPicked: number; qtyShipped?: number };

/** Still to be picked: outstanding minus what is already registered as picked. */
export function pickableQuantity(line: Line): number {
  return Math.max(Number(line.qtyOutstanding) - Number(line.qtyPicked), 0);
}

/** Shipping uses what has been picked and not yet shipped; locations without picks use Qty. to Ship. */
export function shippableQuantity(line: Line): number {
  const available = Number(line.qtyPicked) > 0 ? Number(line.qtyPicked) - Number(line.qtyShipped ?? 0) : Number(line.qtyToShip);
  return Math.max(Math.min(available, Number(line.qtyOutstanding)), 0);
}

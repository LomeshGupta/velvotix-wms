export type ShipmentLineQty = {
  quantity?: number;
  qtyToShip: number;
  qtyOutstanding: number;
  qtyPicked: number;
  qtyShipped?: number;
  pickQty?: number;
  qtyPacked?: number;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Create Pick: whole open quantity, i.e. outstanding minus picked minus what is already on an open pick. */
export function createPickQuantity(l: ShipmentLineQty): number {
  return Math.max(n(l.qtyOutstanding) - n(l.qtyPicked) - n(l.pickQty), 0);
}

/** Pick: what is on open picks (never more than outstanding minus picked). Older servers without pickQty fall back to that bound. */
export function pickableQuantity(l: ShipmentLineQty): number {
  const bound = Math.max(n(l.qtyOutstanding) - n(l.qtyPicked), 0);
  return l.pickQty === undefined ? bound : Math.min(bound, Math.max(n(l.pickQty), 0));
}

/** Pack: picked goods not yet packed (locations without picks: outstanding not yet packed). */
export function packableQuantity(l: ShipmentLineQty): number {
  const base = n(l.qtyPicked) > 0 ? n(l.qtyPicked) : n(l.qtyOutstanding);
  return Math.max(base - n(l.qtyPacked), 0);
}

/** Ship: picked and not yet shipped (locations without picks use Qty. to Ship); once a line has packed goods, only packed goods ship. */
export function shippableQuantity(l: ShipmentLineQty): number {
  let available = n(l.qtyPicked) > 0 ? n(l.qtyPicked) - n(l.qtyShipped) : n(l.qtyToShip);
  if (n(l.qtyPacked) > 0) available = Math.min(available, n(l.qtyPacked) - n(l.qtyShipped));
  return Math.max(Math.min(available, n(l.qtyOutstanding)), 0);
}

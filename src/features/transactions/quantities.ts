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

/**
 * Business Central's Qty. Picked and Qty. Shipped are cumulative: shipping does NOT reduce Qty. Picked.
 * So what is left to pick is always Quantity - Qty. Picked (never Qty. Outstanding - Qty. Picked, which
 * hits 0 as soon as part of the order has shipped). Falls back to outstanding + shipped when the
 * server does not send the line quantity.
 */
export function totalQuantity(l: ShipmentLineQty): number {
  return l.quantity !== undefined ? n(l.quantity) : n(l.qtyOutstanding) + n(l.qtyShipped);
}

/** Create Pick: whole open quantity = Quantity - Qty. Picked - what is already on an open pick (BC's own formula). */
export function createPickQuantity(l: ShipmentLineQty): number {
  return Math.max(totalQuantity(l) - n(l.qtyPicked) - n(l.pickQty), 0);
}

/** Pick: what is on open picks, never more than Quantity - Qty. Picked. Older servers without pickQty use that bound. */
export function pickableQuantity(l: ShipmentLineQty): number {
  const bound = Math.max(totalQuantity(l) - n(l.qtyPicked), 0);
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

// Layer-2 domain model for the Purchasing module.
//
// Purchasing was the one four-layer module with no model layer: its adapter re-exports the wire
// schemas' inferred types directly, so Layer-4 components read wire shapes. That is workable while
// nothing is derived — and stops being workable the moment two screens need the same derivation
// and each grows its own copy.
//
// This file holds the derivations, not a re-declaration of every wire type. Duplicating the shapes
// would be busywork that drifts; naming the RULES is what earns a layer.

import type { PurchaseOrder, VendorItem } from "@/lib/adapters/purchasing.adapter";

type PurchaseOrderLine = PurchaseOrder["lines"][number];

/**
 * The quantity an invoice line should default to: what actually ARRIVED.
 *
 * <p>The invoice form used to default to the ordered quantity, because that was all the PO line
 * carried. On a partial delivery that pre-fills a liability for goods nobody received — the
 * three-way match flags it, but only after the invoice exists and only if someone reads the flag.
 *
 * <p>Falls back to the ordered quantity when the backend reports no received figure at all, which
 * is the honest reading of "unknown": it restores the previous behaviour rather than silently
 * proposing to invoice nothing.
 */
export function receivedOrOrderedQty(line: PurchaseOrderLine): string {
  const received = line.receivedQty;
  if (received === null || received === undefined) {
    return line.qty;
  }
  return received;
}

/** Nothing on this line has been received yet — the three-way match would call it MISSING_GRN. */
export function isAwaitingDelivery(line: PurchaseOrderLine): boolean {
  const received = line.receivedQty;
  return received !== null && received !== undefined && Number(received) <= 0;
}

/** Some but not all of the line arrived, so an invoice for the full order would over-bill. */
export function isPartiallyReceived(line: PurchaseOrderLine): boolean {
  const received = line.receivedQty;
  if (received === null || received === undefined) {
    return false;
  }
  const receivedNum = Number(received);
  return receivedNum > 0 && receivedNum < Number(line.qty);
}

/**
 * How many pack units one order unit holds, defaulting to one.
 *
 * <p>The number a goods receipt is converted BY: quantities are ordered and priced in
 * `orderUom`, and inventory converts from `packUom` into the ingredient's stock unit. A missing or
 * non-positive factor means one order unit is one pack unit — matching what the GRN consumer
 * assumes, so the UI and the conversion never disagree.
 */
export function packUnitsPerOrderUnit(item: Pick<VendorItem, "packQty">): number {
  const factor = Number(item.packQty ?? 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * A catalog row's current price, or null when it has never been priced.
 *
 * <p>Null is not zero and must not render as "Rs 0.00": an unpriced item cannot derive a PO line
 * price at all, and the backend refuses that line rather than treating it as free.
 */
export function currentPricePaisa(item: VendorItem): number | null {
  return item.currentUnitPricePaisa ?? null;
}

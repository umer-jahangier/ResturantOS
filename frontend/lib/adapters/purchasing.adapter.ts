import type { z } from "zod";
import type {
  apiApPaymentSchema,
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorCategorySchema,
  apiVendorInvoiceSchema,
  apiVendorItemPriceChangeSchema,
  apiVendorItemPriceSchema,
  apiVendorItemSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  createApPaymentInputSchema,
  createPurchaseOrderInputSchema,
  createVendorInvoiceInputSchema,
  createVendorItemInputSchema,
  overrideMatchInputSchema,
  recordVendorItemPriceInputSchema,
  rejectPoInputSchema,
  updateVendorItemInputSchema,
  vendorCategoriesInputSchema,
  vendorInputSchema,
} from "@/lib/api-client/schemas/purchasing.schema";

export type Vendor = z.infer<typeof apiVendorSchema>;
/** Write payload for creating or updating a vendor (PUR-01). */
export type VendorInput = z.infer<typeof vendorInputSchema>;
export type PurchaseOrder = z.infer<typeof apiPurchaseOrderSchema>;
/** Write payload for `POST /purchase-orders` (mirrors CreatePurchaseOrderRequest). */
export type PurchaseOrderInput = z.infer<typeof createPurchaseOrderInputSchema>;
/** Write payload for `POST /purchase-orders/{id}/reject`. */
export type RejectPoInput = z.infer<typeof rejectPoInputSchema>;
export type VendorInvoice = z.infer<typeof apiVendorInvoiceSchema>;
/** Write payload for `POST /invoices` (mirrors CreateVendorInvoiceRequest — no vendorId/branchId). */
export type VendorInvoiceInput = z.infer<typeof createVendorInvoiceInputSchema>;
/** Write payload for `POST /invoices/{id}/override-match`. */
export type OverrideMatchInput = z.infer<typeof overrideMatchInputSchema>;
export type ApPayment = z.infer<typeof apiApPaymentSchema>;
/** Write payload for `POST /payments` (mirrors CreateApPaymentRequest — no branchId/method). */
export type ApPaymentInput = z.infer<typeof createApPaymentInputSchema>;
export type SpendAnalytics = z.infer<typeof apiSpendAnalyticsSchema>;
export type VendorScorecard = z.infer<typeof apiVendorScorecardSchema>;

// ── Vendor item catalog (PUR-07) ─────────────────────────────────────────────────────────────
export type VendorItem = z.infer<typeof apiVendorItemSchema>;
/** Write payload for `POST /vendors/{vendorId}/items` (mirrors CreateVendorItemRequest). */
export type VendorItemInput = z.infer<typeof createVendorItemInputSchema>;
/**
 * Write payload for `PUT /vendor-items/{id}` (mirrors UpdateVendorItemRequest — no ingredientId,
 * no price fields; price changes go exclusively through VendorItemPriceInput below).
 */
export type UpdateVendorItemInput = z.infer<typeof updateVendorItemInputSchema>;
export type VendorItemPrice = z.infer<typeof apiVendorItemPriceSchema>;
/**
 * Write payload for `POST /vendor-items/{id}/prices` — the ONLY vendor-item price write. There is
 * no corresponding "update price" input type anywhere in this file; recording a price is always a
 * create, mirroring the backend's append-only pricing model.
 */
export type VendorItemPriceInput = z.infer<typeof recordVendorItemPriceInputSchema>;
export type VendorItemPriceChange = z.infer<typeof apiVendorItemPriceChangeSchema>;
export type VendorCategory = z.infer<typeof apiVendorCategorySchema>;
/** Write payload for `PUT /vendors/{vendorId}/categories` — a bare array, no wrapper object. */
export type VendorCategoriesInput = z.infer<typeof vendorCategoriesInputSchema>;

export function adaptVendor(raw: Vendor): Vendor {
  return raw;
}

export function adaptPurchaseOrder(raw: PurchaseOrder): PurchaseOrder {
  return raw;
}

export function adaptVendorInvoice(raw: VendorInvoice): VendorInvoice {
  return raw;
}

export function adaptApPayment(raw: ApPayment): ApPayment {
  return raw;
}

export function adaptSpendAnalytics(raw: SpendAnalytics): SpendAnalytics {
  return raw;
}

export function adaptVendorScorecard(raw: VendorScorecard): VendorScorecard {
  return raw;
}

export function adaptVendorItem(raw: VendorItem): VendorItem {
  return raw;
}

export function adaptVendorItemPrice(raw: VendorItemPrice): VendorItemPrice {
  return raw;
}

export function adaptVendorItemPriceChange(raw: VendorItemPriceChange): VendorItemPriceChange {
  return raw;
}

export function adaptVendorCategory(raw: VendorCategory): VendorCategory {
  return raw;
}

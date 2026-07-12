import type { z } from "zod";
import type {
  apiApPaymentSchema,
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorInvoiceSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
  createApPaymentInputSchema,
  createPurchaseOrderInputSchema,
  createVendorInvoiceInputSchema,
  overrideMatchInputSchema,
  rejectPoInputSchema,
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

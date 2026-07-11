import type { z } from "zod";
import type {
  apiPurchaseOrderSchema,
  apiSpendAnalyticsSchema,
  apiVendorInvoiceSchema,
  apiVendorScorecardSchema,
  apiVendorSchema,
} from "@/lib/api-client/schemas/purchasing.schema";

export type Vendor = z.infer<typeof apiVendorSchema>;
export type PurchaseOrder = z.infer<typeof apiPurchaseOrderSchema>;
export type VendorInvoice = z.infer<typeof apiVendorInvoiceSchema>;
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

export function adaptSpendAnalytics(raw: SpendAnalytics): SpendAnalytics {
  return raw;
}

export function adaptVendorScorecard(raw: VendorScorecard): VendorScorecard {
  return raw;
}

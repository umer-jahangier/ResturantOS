import { z } from "zod";

// Mirrors VendorDto. `bankAccountLast4` is the ONLY bank field the API ever returns —
// the account number itself is stored AES-encrypted and is never sent to a client (PUR-01).
export const apiVendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contactPerson: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  paymentTerms: z.string(),
  ntn: z.string().nullable().optional(),
  strn: z.string().nullable().optional(),
  leadTimeDays: z.number().int().nullable().optional(),
  bankAccountLast4: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean(),
});

// Mirrors CreateVendorRequest — the write payload for both create (POST) and update (PUT).
// `bankAccountNo` is write-only: send it to set/rotate the account, omit it to leave the
// stored value untouched (VendorService.apply() only writes it when non-blank).
export const vendorInputSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  paymentTerms: z.string().min(1),
  ntn: z.string().optional(),
  strn: z.string().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  bankAccountNo: z.string().optional(),
  notes: z.string().optional(),
});

export const apiPoLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: z.string(),
  uom: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
});

export const apiPurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  status: z.string(),
  expectedDeliveryDate: z.string().nullable().optional(),
  totalPaisa: z.number().int(),
  closedAt: z.string().nullable().optional(),
  closeReason: z.string().nullable().optional(),
  lines: z.array(apiPoLineSchema),
});

export const apiInvoiceLineSchema = z.object({
  id: z.string(),
  poLineId: z.string().uuid(),
  qty: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
  matchStatus: z.string(),
  grnQty: z.string().optional(),
  poQty: z.string().optional(),
  poUnitPricePaisa: z.number().int().optional(),
});

export const apiVendorInvoiceSchema = z.object({
  id: z.string(),
  vendorId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  branchId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  status: z.string(),
  totalPaisa: z.number().int(),
  inputTaxPaisa: z.number().int(),
  matchOverrideReason: z.string().nullable().optional(),
  lines: z.array(apiInvoiceLineSchema),
});

/** PUR-06: one spend-analytics row (vendor or category bucket) with a prior-period comparison. */
export const apiSpendBucketSchema = z.object({
  label: z.string(),
  id: z.string().uuid().nullable(),
  spendPaisa: z.number().int(),
  priorSpendPaisa: z.number().int(),
  deltaPaisa: z.number().int(),
  deltaPct: z.number().nullable(),
});

export const apiSpendAnalyticsSchema = z.object({
  branchId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  compareFrom: z.string(),
  compareTo: z.string(),
  byVendor: z.array(apiSpendBucketSchema),
  byCategory: z.array(apiSpendBucketSchema),
});

/** PUR-05: vendor scorecard — on-time delivery, fill rate, price variance, total spend. */
export const apiVendorScorecardSchema = z.object({
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  onTimeDeliveryPct: z.number(),
  fillRatePct: z.number(),
  priceVariancePct: z.number(),
  totalSpendPaisa: z.number().int(),
  purchaseOrderCount: z.number().int(),
});

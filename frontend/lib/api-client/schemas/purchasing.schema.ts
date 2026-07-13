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

/**
 * PoStatus (backend enum, `PoStatus.java`) — canonical order matches the domain lifecycle.
 * DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT -> PARTIALLY_RECEIVED -> FULLY_RECEIVED -> CLOSED,
 * with REJECTED as an alternate terminal-ish state off PENDING_APPROVAL.
 */
export const PO_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
] as const;
export const poStatusSchema = z.enum(PO_STATUSES);
export type PoStatus = z.infer<typeof poStatusSchema>;

// `qty` is a backend BigDecimal (PurchaseOrderDto.LineDto) with no custom Jackson serializer, so
// the real API returns it as a JSON number (e.g. `100` or `12.5`), not a string — coerce either
// shape to a string so downstream money/qty formatting has one consistent type.
const qtyField = z.union([z.string(), z.number()]).transform((v) => String(v));

export const apiPoLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: qtyField,
  uom: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
});

// Mirrors PurchaseOrderDto exactly (services/purchasing-service .../dto/PurchaseOrderDto.java).
export const apiPurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  status: z.string(),
  expectedDeliveryDate: z.string().nullable().optional(),
  totalPaisa: z.number().int(),
  notes: z.string().nullable().optional(),
  requesterId: z.string().uuid().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  requiredTiers: z.number().int().nullable().optional(),
  tiersApproved: z.number().int().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  closeReason: z.string().nullable().optional(),
  lines: z.array(apiPoLineSchema),
});

// Mirrors CreatePurchaseOrderRequest exactly (services/purchasing-service .../dto/
// CreatePurchaseOrderRequest.java) — NOTE: the backend Line has no `description` field (unlike
// some earlier plan prose assumed); it has `ingredientId`, `qty`, `uom`, `unitPricePaisa`. `qty`
// is sent as a numeric string; Jackson's BigDecimal deserializer accepts both JSON strings and
// numbers.
export const createPurchaseOrderLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.string().min(1, "Quantity is required"),
  uom: z.string().min(1, "Unit is required"),
  unitPricePaisa: z.number().int().nonnegative(),
});

export const createPurchaseOrderInputSchema = z.object({
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  expectedDeliveryDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(createPurchaseOrderLineInputSchema).min(1, "Add at least one line"),
});

/** Params for `GET /api/v1/purchasing/purchase-orders`. */
export const poListParamsSchema = z.object({
  branchId: z.string().uuid(),
  status: z.array(poStatusSchema).optional(),
});

/** Write payload for `POST /purchase-orders/{id}/reject` — `reason` is mandatory server-side. */
export const rejectPoInputSchema = z.object({
  reason: z.string().min(1, "A reason is required to reject a purchase order"),
});

/**
 * InvoiceStatus (backend enum, `InvoiceStatus.java`) — PENDING_MATCH is the theoretical
 * pre-match state; in practice `VendorInvoiceService.create` always runs the 3-way match
 * synchronously, so an invoice is created straight into MATCHED or MISMATCHED.
 */
export const INVOICE_STATUSES = [
  "PENDING_MATCH",
  "MATCHED",
  "MISMATCHED",
  "APPROVED_FOR_PAYMENT",
  "PAID",
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * LineMatchStatus (backend enum, `LineMatchStatus.java`) — read from source, NOT guessed: it is
 * OK/QTY_OVER/QTY_UNDER/PRICE_OVER/PRICE_UNDER/MISSING_GRN/PENDING, not the MATCHED/PRICE_VARIANCE/
 * QTY_VARIANCE vocabulary some earlier plan prose assumed.
 */
export const LINE_MATCH_STATUSES = [
  "OK",
  "QTY_OVER",
  "QTY_UNDER",
  "PRICE_OVER",
  "PRICE_UNDER",
  "MISSING_GRN",
  "PENDING",
] as const;
export const lineMatchStatusSchema = z.enum(LINE_MATCH_STATUSES);

// VendorInvoiceDto.LineDto (real backend) has NO poQty/poUnitPricePaisa/grnQty fields — only
// id/poLineId/qty/unitPricePaisa/lineTotalPaisa/matchStatus. ThreeWayMatchTable's PO/GRN columns
// degrade to "—" against the real API (kept optional here so the MSW-only fixture fields don't
// break .parse() during the transition — see 10-13-SUMMARY "Decisions Made").
export const apiInvoiceLineSchema = z.object({
  id: z.string(),
  poLineId: z.string().uuid(),
  qty: qtyField,
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

/** Params for `GET /api/v1/purchasing/invoices`. */
export const invoiceListParamsSchema = z.object({
  branchId: z.string().uuid(),
  status: z.array(invoiceStatusSchema).optional(),
});

// Mirrors CreateVendorInvoiceRequest exactly (services/purchasing-service .../dto/
// CreateVendorInvoiceRequest.java) — NOTE: the backend takes NO vendorId/branchId (both are
// derived server-side from the referenced PO); the field is `purchaseOrderId`, not `poId`. `qty`
// is sent as a numeric string; Jackson's BigDecimal deserializer accepts both.
export const createVendorInvoiceLineInputSchema = z.object({
  poLineId: z.string().uuid(),
  qty: z.string().min(1, "Quantity is required"),
  unitPricePaisa: z.number().int().nonnegative(),
});

export const createVendorInvoiceInputSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  invoiceNo: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  inputTaxPaisa: z.number().int().nonnegative().optional(),
  lines: z.array(createVendorInvoiceLineInputSchema).min(1, "Add at least one line"),
});

// Mirrors VendorInvoiceService.overrideMatch's justification param. The backend only rejects a
// blank justification; a >= 10-char minimum is a client-side UX requirement per the plan ("a
// 1-char justification is not one") — enforced here, not on the server.
export const overrideMatchInputSchema = z.object({
  justification: z.string().min(10, "Provide at least 10 characters of justification"),
});

// Mirrors CreateApPaymentRequest exactly (services/purchasing-service .../dto/
// CreateApPaymentRequest.java) — NOTE: NO branchId, NO method field (both assumed by earlier plan
// prose but absent from the real DTO); branchId/vendorId are derived server-side from the
// invoice. `bankAccountCode` is optional (server defaults to "1110" if omitted).
export const createApPaymentInputSchema = z.object({
  invoiceId: z.string().uuid(),
  paymentDate: z.string().min(1, "Payment date is required"),
  amountPaisa: z.number().int().positive(),
  bankAccountCode: z.string().optional(),
});

export const apiApPaymentAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPaisa: z.number().int(),
});

// Mirrors ApPaymentDto exactly — no top-level invoiceId/status; the invoice(s) paid are under
// `allocations` (one payment can in principle allocate across several invoices, though this
// plan's single-invoice payment flow always sends exactly one).
export const apiApPaymentSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  branchId: z.string().uuid(),
  paymentDate: z.string(),
  amountPaisa: z.number().int(),
  bankAccountCode: z.string(),
  allocations: z.array(apiApPaymentAllocationSchema),
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

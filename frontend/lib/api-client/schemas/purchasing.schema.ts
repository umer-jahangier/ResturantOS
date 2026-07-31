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

// ── Vendor item catalog (PUR-07) ────────────────────────────────────────────────────────────
// `qtyField` (declared below, before first use) coerces a backend BigDecimal to a string; it is
// reused here for the same reason it exists for PO lines — Jackson serializes BigDecimal as a
// bare JSON number with no custom serializer configured for this service.
const qtyField = z.union([z.string(), z.number()]).transform((v) => String(v));

/**
 * Mirrors VendorItemDto exactly (services/purchasing-service .../dto/VendorItemDto.java) — one
 * vendor's catalog row. apiVendorItemSchema's `currentUnitPricePaisa`/`currentPriceUom`/
 * `currentPriceEffectiveFrom` trio is nullable together: a catalog row may exist before its first
 * price is ever recorded (`VendorItemPriceService.recordNewPrice` is the only writer of price rows).
 */
export const apiVendorItemSchema = z.object({
  id: z.string().uuid(),
  vendorId: z.string().uuid(),
  ingredientId: z.string().uuid(),
  vendorSku: z.string().nullable().optional(),
  vendorDescription: z.string().nullable().optional(),
  orderUom: z.string(),
  packDescription: z.string().nullable().optional(),
  packQty: qtyField,
  packUom: z.string(),
  minOrderQty: qtyField.nullable().optional(),
  orderMultiple: qtyField.nullable().optional(),
  leadTimeDays: z.number().int().nullable().optional(),
  preferred: z.boolean(),
  catchWeight: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  currentUnitPricePaisa: z.number().int().nullable().optional(),
  currentPriceUom: z.string().nullable().optional(),
  currentPriceEffectiveFrom: z.string().nullable().optional(),
});

/**
 * Mirrors CreateVendorItemRequest exactly (dto/CreateVendorItemRequest.java). `initialUnitPricePaisa`
 * is optional — when present the "Add catalog item" dialog seeds the first price row in the same
 * call (the service delegates to `VendorItemPriceService.recordNewPrice`, never a direct insert).
 */
export const createVendorItemInputSchema = z.object({
  ingredientId: z.string().uuid(),
  vendorSku: z.string().max(80).optional(),
  vendorDescription: z.string().optional(),
  gtin: z.string().optional(),
  orderUom: z.string().min(1, "Order unit is required"),
  packDescription: z.string().optional(),
  packQty: qtyField,
  packUom: z.string().min(1, "Pack unit is required"),
  minOrderQty: qtyField.optional(),
  orderMultiple: qtyField.optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  preferred: z.boolean().optional(),
  catchWeight: z.boolean().optional(),
  initialUnitPricePaisa: z.number().int().nonnegative().optional(),
  initialPriceUom: z.string().optional(),
  initialPriceEffectiveFrom: z.string().optional(),
});

/**
 * Mirrors UpdateVendorItemRequest exactly (dto/UpdateVendorItemRequest.java) — deliberately has NO
 * ingredient reference (immutable once set; re-pointing a catalog row at a different ingredient
 * creates a new row instead, per RESEARCH §9.4) and NO price fields — price changes go exclusively
 * through `recordVendorItemPriceInputSchema` below.
 */
export const updateVendorItemInputSchema = z.object({
  vendorSku: z.string().max(80).optional(),
  vendorDescription: z.string().optional(),
  gtin: z.string().optional(),
  orderUom: z.string().min(1, "Order unit is required"),
  packDescription: z.string().optional(),
  packQty: qtyField,
  packUom: z.string().min(1, "Pack unit is required"),
  minOrderQty: qtyField.optional(),
  orderMultiple: qtyField.optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  preferred: z.boolean().optional(),
  catchWeight: z.boolean().optional(),
});

/**
 * Mirrors RecordVendorItemPriceRequest exactly (dto/RecordVendorItemPriceRequest.java). There is
 * deliberately no schema for editing a previously recorded price anywhere in this file —
 * recordVendorItemPriceInputSchema is the only way a client can write a vendor item's price,
 * mirroring the backend's append-only `VendorItemPriceService.recordNewPrice` (the sole writer of
 * `vendor_item_prices` rows; the prior open row's `effectiveTo` is closed, never its price).
 */
export const recordVendorItemPriceInputSchema = z.object({
  unitPricePaisa: z.number().int().nonnegative(),
  priceUom: z.string().min(1, "Price unit is required"),
  effectiveFrom: z.string().optional(),
  branchId: z.string().uuid().optional(),
  contractPrice: z.boolean().optional(),
  source: z.string().optional(),
});

/** Mirrors VendorItemPriceDto exactly (dto/VendorItemPriceDto.java) — one append-only price row. */
export const apiVendorItemPriceSchema = z.object({
  id: z.string().uuid(),
  vendorItemId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  unitPricePaisa: z.number().int(),
  priceUom: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  contractPrice: z.boolean(),
});

/**
 * Mirrors VendorItemPriceChangeDto exactly (dto/VendorItemPriceChangeDto.java). `deltaPct` is null
 * when there is no previous price (the first-ever price row for that catalog item).
 */
export const apiVendorItemPriceChangeSchema = z.object({
  vendorItemId: z.string().uuid(),
  vendorSku: z.string().nullable().optional(),
  vendorDescription: z.string().nullable().optional(),
  previousUnitPricePaisa: z.number().int().nullable().optional(),
  newUnitPricePaisa: z.number().int(),
  deltaPct: qtyField.nullable(),
  effectiveFrom: z.string(),
});

/**
 * Mirrors VendorCategoryDto exactly (dto/VendorCategoryDto.java) — filter/suggestion tags only;
 * `VendorItemController`'s own javadoc states these are never consulted by any authorization
 * decision.
 */
export const apiVendorCategorySchema = z.object({
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  preferred: z.boolean(),
});

/**
 * Write payload for `PUT /vendors/{vendorId}/categories` — the controller takes the replacement
 * set directly as a JSON array request body (no wrapper object), so this schema mirrors that shape
 * exactly rather than nesting the array under a `categories` key.
 */
export const vendorCategoriesInputSchema = z.array(
  z.object({
    categoryId: z.string().uuid(),
    categoryName: z.string().min(1, "Category name is required"),
    preferred: z.boolean(),
  }),
);

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
// shape to a string so downstream money/qty formatting has one consistent type. (`qtyField` itself
// is declared once, above, before the vendor-catalog schemas that also need it.)

// Extended (08.2-13/PUR-08) with vendorItemId/vendorSku/packDescription/priceOverridden — all
// nullable, since a legacy line (created before the catalog-driven PO line existed) has none of
// them. Mirrors PurchaseOrderDto.LineDto exactly.
export const apiPoLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: qtyField,
  uom: z.string(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
  vendorItemId: z.string().uuid().nullable().optional(),
  vendorSku: z.string().nullable().optional(),
  packDescription: z.string().nullable().optional(),
  priceOverridden: z.boolean().nullable().optional(),
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

/**
 * Mirrors CreatePurchaseOrderRequest.Line exactly (services/purchasing-service .../dto/
 * CreatePurchaseOrderRequest.java) as of 08.2-10/PUR-08's catalog-driven rewrite. The backend
 * record itself accepts either `vendorItemId` OR the legacy hand-typed `ingredientId` — but this
 * CLIENT schema deliberately requires `vendorItemId` and has no `ingredientId` field at all: the
 * UI contract (08.2-UI-SPEC Screen 5) makes the catalog picker the only way to set a line's item,
 * so an `ingredientId` escape hatch in the write contract would let the deleted free-text UUID
 * input quietly come back. `uom`/`unitPricePaisa` are optional — the server fills both from the
 * catalog entry when absent, and a supplied `unitPricePaisa` overrides the catalog price (surfaced
 * on the response as `priceOverridden`). `vendorItemId` defaults to `""` in an unpicked form row,
 * so the `.refine` below (rather than a bare `.uuid()` error) is what the picker's "no item
 * selected yet" state actually renders, and only at submit time (react-hook-form's `onSubmit`
 * validation mode), per the UI-SPEC's validation-timing requirement.
 */
export const createPurchaseOrderLineInputSchema = z
  .object({
    vendorItemId: z.string().uuid({ message: "Select a catalog item before adding this line" }).or(z.literal("")),
    qty: z.string().min(1, "Quantity is required"),
    uom: z.string().optional(),
    unitPricePaisa: z.number().int().nonnegative().optional(),
  })
  .refine((line) => line.vendorItemId !== "", {
    message: "Select a catalog item before adding this line",
    path: ["vendorItemId"],
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

// ── Order suggestions (PUR: the first consumer of ingredients.par_level) ──────────────────────

/**
 * Mirrors OrderSuggestionDto. Two quantities on purpose: `shortfallQty` is what the shelf is
 * missing in the STOCK unit ("15 kg"), `orderQty` is what you actually buy in the supplier's ORDER
 * unit after pack size, minimum order and order multiple ("2 cases"). Showing only the second
 * hides why it is bigger than expected; showing only the first is not orderable.
 *
 * A non-null `blockedReason` means the row cannot become a PO line as it stands. Such rows are
 * still returned — a list that silently drops what it cannot solve reads as "everything else is
 * fine".
 */
export const apiOrderSuggestionSchema = z.object({
  ingredientId: z.string().uuid(),
  ingredientName: z.string(),
  sku: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),

  qtyOnHand: qtyField,
  reorderPoint: qtyField,
  parLevel: qtyField,
  stockUom: z.string().nullable().optional(),
  shortfallQty: qtyField.nullable().optional(),

  vendorId: z.string().uuid().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  vendorItemId: z.string().uuid().nullable().optional(),
  vendorSku: z.string().nullable().optional(),
  packDescription: z.string().nullable().optional(),
  orderUom: z.string().nullable().optional(),
  orderQty: qtyField.nullable().optional(),
  unitPricePaisa: z.number().int().nullable().optional(),
  lineTotalPaisa: z.number().int().nullable().optional(),
  leadTimeDays: z.number().int().nullable().optional(),

  blockedReason: z.string().nullable().optional(),
});

/** One purchase order goes to one supplier, so the server groups by vendor and the UI renders
 * that grouping rather than re-deriving it. */
export const apiOrderSuggestionVendorGroupSchema = z.object({
  vendorId: z.string().uuid(),
  vendorName: z.string().nullable().optional(),
  leadTimeDays: z.number().int().nullable().optional(),
  estimatedTotalPaisa: z.number().int(),
  lines: z.array(apiOrderSuggestionSchema),
});

export const apiOrderSuggestionsResponseSchema = z.object({
  branchId: z.string().uuid(),
  vendorGroups: z.array(apiOrderSuggestionVendorGroupSchema),
  unassigned: z.array(apiOrderSuggestionSchema),
  blockedCount: z.number().int(),
  estimatedTotalPaisa: z.number().int(),
});

/**
 * Mirrors OrderSuggestionDto.CreateFromSuggestionsRequest. The REVIEWED numbers are sent back
 * rather than a "create everything" flag: suggestions recompute on every read, so acting on a
 * server-side recomputation would order whatever was true at click time instead of what the buyer
 * actually saw.
 */
export const createDraftsFromSuggestionsInputSchema = z.object({
  branchId: z.string().uuid(),
  lines: z
    .array(z.object({ vendorItemId: z.string().uuid(), qty: z.string().min(1) }))
    .min(1, "Select at least one line"),
});

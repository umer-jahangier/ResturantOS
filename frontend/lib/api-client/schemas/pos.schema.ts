import { z } from "zod";

// RAW API field names from pos-service contract (Phase 7).
// This module is the ONLY place that knows the wire shape — repositories
// `.parse()` here and adapters convert to domain models.

export const apiMenuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  // Backend's MenuItemDto has always carried this (it's how the order-taking grid COULD group
  // without a client-side join) — just never parsed here since the read-only grid groups by
  // categoryId against its own separately-fetched category list. The Menu Items admin page
  // wants it directly rather than re-deriving it.
  categoryName: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  basePricePaisa: z.number().int().nonnegative(),
  taxRatePct: z.string().or(z.number()).transform(Number),
  // S0-03: the wire has always carried this — the fiscal classification an item is filed under
  // ("SR-STD-17"). It was never parsed, so it could not reach the domain model, so the edit
  // dialog could not send it back, and a PUT (where an absent key means REMOVE) wiped it on a
  // description-only edit. Parsing it is the first of the four layers that had to change.
  taxRateCode: z.string().nullable().optional(),
  kdsStation: z.string().nullable().optional(),
  active: z.boolean(),
  // 19b: menu-item pictures. `imageFileId` is the file-service id that round-trips on update;
  // `imageUrl` is derived server-side (/api/v1/files/{id}/download) so the route lives in one
  // place. Both optional — an item saved before this phase carries neither.
  imageFileId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  // ── F16: tax classes ──────────────────────────────────────────────────────────────────────
  // `taxClassId` is the item's OVERRIDE — null means INHERIT THE CATEGORY, not zero-rated.
  // The four `effectiveTax*` fields are what the item is ACTUALLY taxed at, resolved server-side
  // (item class -> category class -> the legacy per-item rate above -> zero). The till prices a
  // cart from `effectiveTaxRatePct` and never from `taxRatePct`: a second copy of that
  // resolution order in TypeScript would be a second answer.
  //
  // All five are `.optional()` so a response from a pos-service that predates F16 still parses.
  taxClassId: z.string().uuid().nullable().optional(),
  effectiveTaxRatePct: z.string().or(z.number()).transform(Number).nullable().optional(),
  effectiveTaxRateCode: z.string().nullable().optional(),
  effectiveTaxLabel: z.string().nullable().optional(),
  effectiveTaxSource: z.string().nullable().optional(),
});

export type ApiMenuItem = z.infer<typeof apiMenuItemSchema>;

export const apiMenuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  // F16: the tax class every item in this category inherits, with its name and rate carried
  // alongside so the menu screen can print "Standard rate 17%" without joining two lists.
  taxClassId: z.string().uuid().nullable().optional(),
  taxClassName: z.string().nullable().optional(),
  taxClassRatePct: z.string().or(z.number()).transform(Number).nullable().optional(),
});

export type ApiMenuCategory = z.infer<typeof apiMenuCategorySchema>;

// ── Menu admin writes (create/deactivate items + categories) ───────────────────────────────
// Mirrors MenuItemAdminDtos.CreateMenuItemRequest / MenuCategoryAdminDtos.CreateMenuCategoryRequest
// exactly. Price travels as `basePricePaisa` on the wire — the UI collects rupees and converts,
// same convention as VendorItemPriceDialog's `unitPriceRupees` -> `Math.round(v * 100)`.
export const createMenuCategoryInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
  // `.nullable()` and always sent — the same reason `imageFileId` is. On update the backend
  // reads null as CLEAR THE RULE and an omitted key identically, so "this category has no tax
  // rule" is only expressible if null can travel.
  taxClassId: z.string().uuid().nullable().optional(),
});
export type CreateMenuCategoryInput = z.infer<typeof createMenuCategoryInputSchema>;

/**
 * Category UPDATE is a REPLACE too, and `taxClassId` is REQUIRED here for the reason
 * `updateMenuItemInputSchema` makes `taxRateCode` required: omitting it clears the whole
 * category's tax rule, silently, on an unrelated rename. That is S0-03's shape, one level up.
 */
export const updateMenuCategoryInputSchema = createMenuCategoryInputSchema.extend({
  taxClassId: z.string().uuid().nullable(),
});
export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategoryInputSchema>;

export const createMenuItemInputSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  basePricePaisa: z.number().int().nonnegative(),
  taxRatePct: z.number().optional(),
  taxRateCode: z.string().nullable().optional(),
  // `.nullable()` and NOT `.optional()` alone — deliberate. On update the backend reads null as
  // REMOVE THE PICTURE and an omitted field the same way, so "remove" is only expressible if
  // null can be sent. The form always supplies this key explicitly (null when there is no
  // image), which is the same always-send-it convention `updateMenuItem` documents for
  // categoryId; an `undefined` here would be dropped by JSON.stringify and silently mean
  // "remove" as well, so sending null keeps intent and wire in agreement.
  imageFileId: z.string().uuid().nullable().optional(),
  // F16 override. Null = follow the category, which is what a new dish should almost always do.
  taxClassId: z.string().uuid().nullable().optional(),
});
export type CreateMenuItemInput = z.infer<typeof createMenuItemInputSchema>;

/**
 * UPDATE is a REPLACE, and its own type says so.
 *
 * PUT /pos/menu/items/{id} does not merge: `MenuServiceImpl.updateItem` assigns every field it
 * is given, and for `taxRateCode` and `imageFileId` an absent key reads exactly like null —
 * REMOVE. Reusing `createMenuItemInputSchema` here (which is what shipped) made those three
 * fields optional on the update path too, so a caller could build a legal payload that silently
 * destroyed an item's fiscal classification. That is S0-03: a description-only edit sent
 * `{categoryId,name,description,basePricePaisa,imageFileId}` and `SR-STD-17` became null.
 *
 * Making the replace-semantics fields REQUIRED is the structural half of the fix — wipe-by-
 * omission stops being representable, in TypeScript at compile time and in zod at the repository
 * boundary, rather than being merely discouraged by a comment. `null` is still accepted and
 * still means remove, so deliberate removal survives.
 */
export const updateMenuItemInputSchema = createMenuItemInputSchema.extend({
  taxRatePct: z.number(),
  taxRateCode: z.string().nullable(),
  imageFileId: z.string().uuid().nullable(),
  // F16 joins the required-but-nullable group. It is a fourth tax-shaped field on the same PUT,
  // which is exactly how S0-03 got in — so it is required from the day it is added rather than
  // after somebody's classification is destroyed by an omitted key.
  taxClassId: z.string().uuid().nullable(),
});
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemInputSchema>;

// NEEDS_BUSSING added — backend TableStatus enum now has 3 values (07.1-PATTERNS.md).
// Widening this enum is a Rule-1 correctness fix: without it, any table returned
// in NEEDS_BUSSING state from GET /pos/tables would throw a ZodError at parse time.
export const apiDiningTableSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  tableName: z.string(),
  capacity: z.number().int(),
  // 19b: `section` is a free-text grouping label, `active` is CATALOGUE state — distinct from
  // `status`, which is runtime state (is someone sitting here right now). Optional so a
  // response from a pos-service that predates V12 still parses.
  section: z.string().nullable().optional(),
  active: z.boolean().optional(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "NEEDS_BUSSING"]),
  floorPlanX: z.number().nullable().optional(),
  floorPlanY: z.number().nullable().optional(),
  floorPlanShape: z.string().nullable().optional(),
});

export type ApiDiningTable = z.infer<typeof apiDiningTableSchema>;

// ── Dining-table catalogue writes (19b) ───────────────────────────────────────────────────
// Mirrors TableAdminDtos.CreateDiningTableRequest / UpdateDiningTableRequest. Capacity is
// bounded on both ends server-side too — it feeds cover counts and therefore per-head
// reporting, so a fat-fingered 400 distorts averages rather than failing visibly.
export const createDiningTableInputSchema = z.object({
  tableNumber: z.string().min(1).max(20),
  capacity: z.number().int().min(1).max(100),
  section: z.string().max(50).optional(),
});
export type CreateDiningTableInput = z.infer<typeof createDiningTableInputSchema>;

// ── Stations (phase 28) ───────────────────────────────────────────────────────────────────
// Mirrors pos-service `StationDto`. Five types, three display families — the mapping is
// asserted server-side on `StationType` and sent down as `displayFamily`, so nothing here
// re-derives it except as a fallback for a response that predates plan 28-02 (see the adapter).
export const STATION_TYPES = ["KITCHEN", "BAR", "PANTRY", "EXPO", "DESSERT"] as const;
export const DISPLAY_FAMILIES = ["KITCHEN", "BAR", "EXPO"] as const;

/**
 * The wire station.
 *
 * <p>`stationType` and `displayFamily` are typed as plain strings rather than enums ON PURPOSE.
 * A `z.enum` would make an unrecognised value a PARSE FAILURE, and a parse failure on a list
 * response empties the whole screen. The narrowing happens in the adapter, where an unknown
 * value degrades to KITCHEN instead of throwing. Tightening this to an enum would convert
 * "someone added a sixth station type" from a cosmetic mislabel into an outage.
 */
export const apiStationSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean().nullable().optional(),
  stationType: z.string().nullable().optional(),
  displayFamily: z.string().nullable().optional(),
});
export type ApiStation = z.infer<typeof apiStationSchema>;

/**
 * Create a station. `code` is the stable routing key — it is what rides a fired ticket, what
 * the KDS WebSocket subscribes on, and what a user's station assignment stores (28-01).
 *
 * <p>It is upper-cased before it is sent. auth-service normalises an assignment's codes to
 * upper case (`StationAssignmentAdminService`), pos-service stores a station's code verbatim,
 * and the KDS scope filter compares the two with `IN`. A station created as `bar` would
 * therefore never match an assignment stored as `BAR`, and the symptom would be a bartender
 * with an empty board and nothing in any log.
 */
export const createStationInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  stationType: z.enum(STATION_TYPES),
});
export type CreateStationInput = z.infer<typeof createStationInputSchema>;

/** Update a station. The code is immutable server-side and is deliberately absent here. */
export const updateStationInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  active: z.boolean(),
  stationType: z.enum(STATION_TYPES),
});
export type UpdateStationInput = z.infer<typeof updateStationInputSchema>;

export const apiOrderItemModifierSchema = z.object({
  id: z.string().uuid(),
  modifierId: z.string().uuid().nullable().optional(),
  modifierNameSnapshot: z.string(),
  priceDeltaPaisa: z.number().int(),
});

// Wire field is still named `kdsStatus` (backend OrderDto.OrderItemDto kept the name —
// see 07.1-03/07.1-01 SUMMARY decisions) but now carries the 7-value OrderItemStatus
// lifecycle. The adapter layer renames this to `itemStatus` on the domain model for a
// clearer downstream name — the raw schema stays faithful to the actual wire contract.
export const apiOrderItemSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  itemNameSnapshot: z.string(),
  unitPriceSnapshot: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  kdsStation: z.string().nullable().optional(),
  kdsStatus: z.enum(["PENDING", "SENT", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"]),
  // `.optional()`: the live pos-service response for POST /orders/{id}/items omits
  // this field too (same class of gap as apiOrderSchema's derivedStatus above,
  // verified via 07.1-06 E2E). adaptOrderItem() defaults the omitted case to 0 — the
  // same default + meaning the backend entity itself declares (OrderItem.java
  // `revisionNo = 0; // 0 = not yet fired`).
  revisionNo: z.number().int().nonnegative().optional(),
  firedAt: z.string().nullable().optional(),
  discountPaisa: z.number().int().nonnegative(),
  taxPaisa: z.number().int().nonnegative(),
  lineTotalPaisa: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  modifiers: z.array(apiOrderItemModifierSchema).default([]),
});

export type ApiOrderItem = z.infer<typeof apiOrderItemSchema>;

// `status` (existing 9-value settlement enum) and `derivedStatus` (new 4-value kitchen
// -progress aggregate) are deliberately DISTINCT fields — never overloaded into one
// (RESEARCH.md Pitfall 3 / 07.1-03 SUMMARY). `derivedStatus` mirrors backend
// DerivedOrderStatus exactly (DRAFT|IN_PROGRESS|PARTIALLY_SERVED|SERVED only — CLOSED/
// VOIDED/REFUNDED live solely on `status`; combine via pos.model's
// getOrderDisplayStatus() for UI rendering).
/**
 * One discount on a check (B3). `.optional()` on the whole array in apiOrderSchema, and
 * nullable on every decoration here, because a pos-service that predates this field must not
 * fail the parse and blank the charge page — the same rule derivedStatus already follows.
 */
export const apiOrderDiscountSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(["LINE", "ORDER"]),
  orderItemId: z.string().uuid().nullable().optional(),
  itemName: z.string().nullable().optional(),
  type: z.string(),
  /** MANUAL | PROMOTION. Optional: rows served by a pos-service older than V30 omit it. */
  source: z.string().nullable().optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  amountPaisa: z.number().int().nonnegative(),
  reason: z.string().nullable().optional(),
  appliedBy: z.string().uuid().nullable().optional(),
  appliedByName: z.string().nullable().optional(),
  appliedAt: z.string().nullable().optional(),
});

export type ApiOrderDiscount = z.infer<typeof apiOrderDiscountSchema>;

export const apiOrderSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "PICKUP"]),
  status: z.enum([
    "DRAFT",
    "OPEN",
    "SENT_TO_KDS",
    "PARTIAL_READY",
    "READY",
    "SERVED",
    "CLOSED",
    "VOIDED",
    "REFUNDED",
  ]),
  // `.optional()`: the live pos-service response for POST /orders and GET /orders/{id}
  // currently omits this field entirely (verified via 07.1-06 E2E — a backend
  // DTO-population gap, not a frontend concern; OrderController.java is mid-edit
  // per git status). adaptOrder() below defaults the omitted case to "DRAFT" — the
  // same default the backend entity itself declares (Order.java `derivedStatus =
  // DerivedOrderStatus.DRAFT`) — rather than hard-failing the whole parse.
  derivedStatus: z.enum(["DRAFT", "IN_PROGRESS", "PARTIALLY_SERVED", "SERVED"]).optional(),
  tableId: z.string().uuid().nullable().optional(),
  coverCount: z.number().int(),
  cashierId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  subtotalPaisa: z.number().int().nonnegative(),
  taxPaisa: z.number().int().nonnegative(),
  discountPaisa: z.number().int().nonnegative(),
  serviceChargePaisa: z.number().int().nonnegative(),
  /**
   * F20 — the service-charge SNAPSHOT: the rate this check was charged at and the branch's own
   * wording for it. Optional and nullable because a pos-service that predates F20 sends neither,
   * and a strict reader here would blank the charge page rather than degrade one caption.
   *
   * `serviceChargePct === 0` with a null label is "this branch takes no service charge", and the
   * screen must then render NO service-charge row at all. `Service charge Rs 0.00` printed on
   * every bill this product ever produced, for a charge no restaurant could set.
   */
  serviceChargePct: z.union([z.number(), z.string()]).nullable().optional(),
  serviceChargeLabel: z.string().nullable().optional(),
  totalPaisa: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  sentToKdsAt: z.string().nullable().optional(),
  clientOrderId: z.string().uuid(),
  version: z.number().int(),
  items: z.array(apiOrderItemSchema).default([]),
  discounts: z.array(apiOrderDiscountSchema).default([]),
});

export type ApiOrder = z.infer<typeof apiOrderSchema>;

// Order Management list row (POS-09) — GET /api/v1/pos/orders now returns this shape,
// not ApiOrder[] (07.1-04 SUMMARY: a deliberate, breaking wire-contract change).
//
// POS-24 (07.3-04/07.3-08): the backend `OrderSummaryDto` was extended with 5 fields so
// Order Management can show closed/paid orders, a payment-status badge, and an
// item-quantity column without a second round trip per row — `settlementStatus` is the
// raw 9-value `OrderStatus` (distinct from `derivedStatus`'s 4-value kitchen-progress
// meaning), `paymentStatus`/`amountPaidPaisa` are server-derived, and
// `itemQuantity`/`distinctItemCount` exclude CANCELLED lines.
export const apiOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  tableId: z.string().uuid().nullable().optional(),
  tableName: z.string().nullable().optional(),
  // F2: REQUIRED, not optional. The row used to carry no type at all, so the client rendered
  // `tableName ?? "Takeaway"` and every tableless DINE_IN check read Takeaway (measured 10/10 on
  // 2026-08-12). An optional field here would let a stale pos-service silently reinstate exactly
  // that guess; a parse failure surfaces as the list's error state instead, which is the truth.
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "PICKUP"]),
  derivedStatus: z.enum(["DRAFT", "IN_PROGRESS", "PARTIALLY_SERVED", "SERVED"]),
  cashierId: z.string().uuid().nullable().optional(),
  // Decoration, exactly like `settlement.byName` below: resolved server-side from the staff
  // directory and null when it could not be reached. The client falls back to the id — never to
  // a blank, which on a "who took this check" column reads as "nobody".
  cashierName: z.string().nullable().optional(),
  coverCount: z.number().int(),
  totalPaisa: z.number().int().nonnegative(),
  openedAt: z.string().nullable().optional(),
  settlementStatus: z.enum([
    "DRAFT",
    "OPEN",
    "SENT_TO_KDS",
    "PARTIAL_READY",
    "READY",
    "SERVED",
    "CLOSED",
    "VOIDED",
    "REFUNDED",
  ]),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "REFUNDED"]),
  amountPaidPaisa: z.number().int().nonnegative(),
  itemQuantity: z.number().int().nonnegative(),
  distinctItemCount: z.number().int().nonnegative(),
  // S0-04: why this order is terminal and who made it so. Present ONLY on VOIDED/REFUNDED rows
  // (the server attaches it in a second pass and leaves live rows untouched), which is why the
  // whole object is nullable rather than its fields being individually optional.
  //
  // `byName` is decoration and can be null even when `byUserId` is not — the server resolves the
  // name from auth-service and degrades to the raw id rather than failing the list.
  settlement: z
    .object({
      reason: z.string().nullable().optional(),
      byUserId: z.string().uuid().nullable().optional(),
      byName: z.string().nullable().optional(),
      at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type ApiOrderSummary = z.infer<typeof apiOrderSummarySchema>;

// PATCH /orders/{id}/table (assign-table, POS-24) request body. Outgoing payload —
// parsed client-side before send as a defense-in-depth mirror, same pattern as
// `apiUpdateInstructionsSchema` above.
export const apiAssignTableRequestSchema = z.object({
  tableId: z.string().uuid(),
});

export type ApiAssignTableRequest = z.infer<typeof apiAssignTableRequestSchema>;

// Table-centric dine-in detail (POS-10) — GET /pos/tables/{id}/active-order.
export const apiTableDetailSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  tableName: z.string(),
  capacity: z.number().int(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "NEEDS_BUSSING"]),
  floorPlanX: z.number().nullable().optional(),
  floorPlanY: z.number().nullable().optional(),
  floorPlanShape: z.string().nullable().optional(),
  activeOrder: apiOrderSchema.nullable(),
  derivedStatus: z.enum(["DRAFT", "IN_PROGRESS", "PARTIALLY_SERVED", "SERVED"]).nullable(),
  cashierId: z.string().uuid().nullable().optional(),
  subtotalPaisa: z.number().int().nonnegative(),
  discountPaisa: z.number().int().nonnegative(),
  taxPaisa: z.number().int().nonnegative(),
  totalPaisa: z.number().int().nonnegative(),
});

export type ApiTableDetail = z.infer<typeof apiTableDetailSchema>;

// PATCH /orders/{id}/instructions request body (POS-13). This is an OUTGOING payload —
// parsed client-side before send as a defense-in-depth mirror of the server's own
// char-limit validation (RESEARCH.md Security Domain V5 / OrderInstructionsIT), not a
// response envelope.
export const apiUpdateInstructionsSchema = z.object({
  notes: z.string().max(240, "Order notes must not exceed 240 characters").nullable().optional(),
  itemNotes: z
    .record(z.string().uuid(), z.string().max(140, "Item notes must not exceed 140 characters"))
    .optional(),
});

export type ApiUpdateInstructions = z.infer<typeof apiUpdateInstructionsSchema>;

export const apiTillSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  cashierId: z.string().uuid(),
  // F21. Nullable AND optional, for two different reasons: null is the server saying "the staff
  // directory did not answer" (the client falls back to the id), absent is a server older than
  // this field. Declared here because `z.object` strips what it does not name — an undeclared
  // cashierName would be parsed away silently and the column would keep printing UUIDs.
  cashierName: z.string().nullable().optional(),
  openingFloatPaisa: z.number().int().nonnegative(),
  expectedClosingPaisa: z.number().int().nullable().optional(),
  declaredClosingPaisa: z.number().int().nullable().optional(),
  variancePaisa: z.number().int().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  status: z.enum(["OPEN", "CLOSED"]),
  note: z.string().nullable().optional(),
  reviewStatus: z.enum(["PENDING_REVIEW", "APPROVED", "FLAGGED"]),
});

export type ApiTillSession = z.infer<typeof apiTillSessionSchema>;

export const apiTillReviewActionSchema = z.object({
  id: z.string().uuid(),
  tillSessionId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  action: z.enum(["APPROVED", "FLAGGED", "NOTED"]),
  note: z.string().nullable().optional(),
  actedAt: z.string(),
});

export type ApiTillReviewAction = z.infer<typeof apiTillReviewActionSchema>;

export const apiTillReconciliationSchema = z.object({
  session: apiTillSessionSchema,
  orderCount: z.number().int().nonnegative(),
  cashCollectedPaisa: z.number().int(),
  nonCashCollectedPaisa: z.number().int(),
  liveExpectedCashPaisa: z.number().int(),
  orders: z.array(
    z.object({
      orderId: z.string().uuid(),
      orderNo: z.string().nullable().optional(),
      status: z.string(),
      totalPaisa: z.number().int(),
      paidPaisa: z.number().int(),
    }),
  ),
});

export type ApiTillReconciliation = z.infer<typeof apiTillReconciliationSchema>;

export const apiOrderPaymentSchema = z.object({
  method: z.enum(["CASH", "CARD", "LOYALTY_POINTS", "BANK_TRANSFER", "VOUCHER"]),
  amountPaisa: z.number().int().nonnegative(),
  referenceNo: z.string().nullable().optional(),
});

export type ApiOrderPayment = z.infer<typeof apiOrderPaymentSchema>;

export const apiCloseOrderSchema = z.object({
  payments: z.array(apiOrderPaymentSchema),
});

// GET /orders/{id}/payments history row (backend OrderPaymentDto, POS-22/23). Distinct
// from `apiOrderPaymentSchema` above (that one is the OUTGOING closeOrder request-line
// shape with no id/recordedAt) — this is the persisted, INCOMING read model.
export const apiOrderPaymentRecordSchema = z.object({
  id: z.string().uuid(),
  method: z.enum([
    "CASH",
    "CARD",
    "LOYALTY_POINTS",
    "BANK_TRANSFER",
    "VOUCHER",
    "CHARGE_TO_ACCOUNT",
  ]),
  // What was APPLIED to the bill. The server caps a TENDER at the outstanding balance, so the
  // applied amounts always sum to the order total — the invariant finance's revenue journal
  // entry depends on.
  //
  // S0-01: SIGNED, and no longer `.nonnegative()`. The endpoint now returns refunds alongside
  // tenders, and a refund is a reversing row with a NEGATIVE amount — that is what makes
  // `payments.reduce(sum)` the NET money held against the order rather than a figure that keeps
  // claiming a refunded bill was paid. A `.nonnegative()` here would have thrown the whole
  // history away at parse time the first time anyone refunded anything.
  amountPaisa: z.number().int(),
  /**
   * F20 — money taken ON TOP of the bill, for the staff. Never part of `amountPaisa`, so every
   * existing caller's `payments.reduce(sum)` keeps answering "what settled the bill" and not
   * "what left the guest's card". Optional for a pos-service that predates F20.
   */
  tipPaisa: z.number().int().optional(),
  tenderedPaisa: z.number().int().optional(),
  changePaisa: z.number().int().nonnegative().optional(),
  referenceNo: z.string().nullable().optional(),
  recordedAt: z.string(),
  /**
   * PAYMENT (a tender taken) or REFUND (money given back). Optional and defaulted for
   * back-compat with a pos-service that predates S0-01 — every row it returns is a tender.
   */
  kind: z.enum(["PAYMENT", "REFUND"]).optional(),
});

export type ApiOrderPaymentRecord = z.infer<typeof apiOrderPaymentRecordSchema>;

// POST /orders/{id}/payments (recordPayment) response body: the running total paid
// paisa for the order (backend PaymentController.recordPayment returns a bare Long via
// ApiResponse<Long>, not an OrderDto — the frontend refetches the order separately to
// pick up any settlement-status change from the maybeCloseOrder seam).
export const apiRecordPaymentResultSchema = z.number().int().nonnegative();

/**
 * POST /orders/{id}/discounts/preview — what a discount WILL do to the check (D-1).
 *
 * Every field is paisa, and every field is the figure the server will write if the same request
 * is sent to the apply route. The panel used to derive these itself by subtracting the discount
 * from a tax-INCLUSIVE total; see `DiscountPreview` in the domain model for the measurement.
 */
export const apiDiscountPreviewSchema = z.object({
  amountOffPaisa: z.number().int().nonnegative(),
  subtotalPaisa: z.number().int(),
  discountPaisa: z.number().int(),
  taxPaisa: z.number().int(),
  serviceChargePaisa: z.number().int(),
  totalPaisa: z.number().int(),
  previousTaxPaisa: z.number().int(),
  previousServiceChargePaisa: z.number().int(),
  previousTotalPaisa: z.number().int(),
});

export type ApiDiscountPreview = z.infer<typeof apiDiscountPreviewSchema>;

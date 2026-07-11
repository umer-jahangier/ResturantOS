import { z } from "zod";

// RAW API field names from pos-service contract (Phase 7).
// This module is the ONLY place that knows the wire shape — repositories
// `.parse()` here and adapters convert to domain models.

export const apiMenuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  basePricePaisa: z.number().int().nonnegative(),
  taxRatePct: z.string().or(z.number()).transform(Number),
  kdsStation: z.string().nullable().optional(),
  active: z.boolean(),
});

export type ApiMenuItem = z.infer<typeof apiMenuItemSchema>;

export const apiMenuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

export type ApiMenuCategory = z.infer<typeof apiMenuCategorySchema>;

// NEEDS_BUSSING added — backend TableStatus enum now has 3 values (07.1-PATTERNS.md).
// Widening this enum is a Rule-1 correctness fix: without it, any table returned
// in NEEDS_BUSSING state from GET /pos/tables would throw a ZodError at parse time.
export const apiDiningTableSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  tableName: z.string(),
  capacity: z.number().int(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "NEEDS_BUSSING"]),
  floorPlanX: z.number().nullable().optional(),
  floorPlanY: z.number().nullable().optional(),
  floorPlanShape: z.string().nullable().optional(),
});

export type ApiDiningTable = z.infer<typeof apiDiningTableSchema>;

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
export const apiOrderSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]),
  status: z.enum(["DRAFT", "OPEN", "SENT_TO_KDS", "PARTIAL_READY", "READY", "SERVED", "CLOSED", "VOIDED", "REFUNDED"]),
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
  totalPaisa: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  sentToKdsAt: z.string().nullable().optional(),
  clientOrderId: z.string().uuid(),
  version: z.number().int(),
  items: z.array(apiOrderItemSchema).default([]),
});

export type ApiOrder = z.infer<typeof apiOrderSchema>;

// Order Management list row (POS-09) — GET /api/v1/pos/orders now returns this shape,
// not ApiOrder[] (07.1-04 SUMMARY: a deliberate, breaking wire-contract change).
export const apiOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  orderNo: z.string().nullable().optional(),
  tableId: z.string().uuid().nullable().optional(),
  tableName: z.string().nullable().optional(),
  derivedStatus: z.enum(["DRAFT", "IN_PROGRESS", "PARTIALLY_SERVED", "SERVED"]),
  cashierId: z.string().uuid().nullable().optional(),
  coverCount: z.number().int(),
  totalPaisa: z.number().int().nonnegative(),
  openedAt: z.string().nullable().optional(),
});

export type ApiOrderSummary = z.infer<typeof apiOrderSummarySchema>;

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
  itemNotes: z.record(z.string().uuid(), z.string().max(140, "Item notes must not exceed 140 characters")).optional(),
});

export type ApiUpdateInstructions = z.infer<typeof apiUpdateInstructionsSchema>;

export const apiTillSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  cashierId: z.string().uuid(),
  openingFloatPaisa: z.number().int().nonnegative(),
  expectedClosingPaisa: z.number().int().nullable().optional(),
  declaredClosingPaisa: z.number().int().nullable().optional(),
  variancePaisa: z.number().int().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  status: z.enum(["OPEN", "CLOSED"]),
});

export type ApiTillSession = z.infer<typeof apiTillSessionSchema>;

export const apiOrderPaymentSchema = z.object({
  method: z.enum(["CASH", "CARD", "LOYALTY_POINTS", "BANK_TRANSFER", "VOUCHER"]),
  amountPaisa: z.number().int().nonnegative(),
  referenceNo: z.string().nullable().optional(),
});

export type ApiOrderPayment = z.infer<typeof apiOrderPaymentSchema>;

export const apiCloseOrderSchema = z.object({
  payments: z.array(apiOrderPaymentSchema),
});

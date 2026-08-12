// Domain types for POS module. Money expressed as number paisa (BIGINT on wire).
// No raw API types leak here — adapters translate from api-client schemas.

export type OrderStatus =
  | "DRAFT"
  | "OPEN"
  | "SENT_TO_KDS"
  | "PARTIAL_READY"
  | "READY"
  | "SERVED"
  | "CLOSED"
  | "VOIDED"
  | "REFUNDED";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "PICKUP";

// 7-value item lifecycle (backend OrderItemStatus). Replaces the old 3-value
// KdsItemStatus — the wire field is still named `kdsStatus` (see pos.schema.ts), but the
// domain model uses the clearer `itemStatus` name (adapter renames at the boundary).
export type OrderItemStatus =
  | "PENDING"
  | "SENT"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "CANCELLED";

// Kitchen-progress aggregate (backend DerivedOrderStatus) — ALWAYS computed server-side,
// never hand-set. Distinct from the settlement `OrderStatus` above (RESEARCH.md Pitfall
// 3) — combine the two via getOrderDisplayStatus() below for UI rendering.
export type DerivedOrderStatus = "DRAFT" | "IN_PROGRESS" | "PARTIALLY_SERVED" | "SERVED";

// The UI-SPEC "Status System"'s 7-state order-status table is this union: the 4
// kitchen-progress values above, PLUS the 3 post-settlement OrderStatus values that
// never co-occur with a live derivedStatus.
export type OrderDisplayStatus = DerivedOrderStatus | "CLOSED" | "VOIDED" | "REFUNDED";

export type TableStatus = "AVAILABLE" | "OCCUPIED" | "NEEDS_BUSSING";

export interface MenuItem {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  basePricePaisa: number;
  taxRatePct: number;
  /**
   * The item's fiscal classification code ("SR-STD-17"), or null if it has none.
   *
   * Round-tripped on update, for the same reason `imageFileId` is: PUT is a replace, and the
   * backend reads an absent `taxRateCode` as REMOVE. This field was missing from the model
   * (while the wire carried it all along), which is why the edit dialog could not send back the
   * classification it was about to overwrite — S0-03.
   */
  taxRateCode: string | null;
  kdsStation: string | null;
  /** file-service id for the item's picture. Round-tripped on update; null means no picture. */
  imageFileId: string | null;
  /** Derived server-side from `imageFileId` — render this, never build the URL client-side. */
  imageUrl: string | null;
  active: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface DiningTable {
  id: string;
  branchId: string;
  tableName: string;
  capacity: number;
  /** Free-text grouping label ("Rooftop", "Garden"). Not an entity — see V12. */
  section: string | null;
  /**
   * CATALOGUE state: does this table still exist in the restaurant. Distinct from `status`,
   * which is RUNTIME state (is someone sitting here right now). A retired table keeps its row
   * forever because closed orders reference it.
   */
  active: boolean;
  status: TableStatus;
  floorPlanX: number | null;
  floorPlanY: number | null;
  floorPlanShape: string | null;
}

// ── Stations (phase 28) ───────────────────────────────────────────────────────────────────

/** The five station types (D-28-01). Chosen from a control, never typed — free text is how
 *  "Bar", "bar" and "BAR " become three stations. */
export type StationType = "KITCHEN" | "BAR" | "PANTRY" | "EXPO" | "DESSERT";

/** Which physical screen a station's tickets appear on. Five types, three screens. */
export type StationDisplayFamily = "KITCHEN" | "BAR" | "EXPO";

export interface Station {
  id: string;
  branchId: string;
  /**
   * The stable routing key. It rides every fired ticket, it is the KDS WebSocket subscription
   * key, and it is what a user's station assignment stores (28-01). Immutable server-side.
   */
  code: string;
  name: string;
  stationType: StationType;
  /** Derived server-side from the type — rendered, never re-derived here. */
  displayFamily: StationDisplayFamily;
  /**
   * CATALOGUE state. A retired station keeps its row forever: fired tickets name it, and the
   * KDS projection is keyed on its code.
   */
  active: boolean;
}

export interface OrderItemModifier {
  id: string;
  modifierId: string | null;
  modifierNameSnapshot: string;
  priceDeltaPaisa: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  kdsStation: string | null;
  itemStatus: OrderItemStatus;
  revisionNo: number;
  firedAt: string | null;
  discountPaisa: number;
  taxPaisa: number;
  lineTotalPaisa: number;
  notes: string | null;
  modifiers: OrderItemModifier[];
}

export interface Order {
  id: string;
  branchId: string;
  orderNo: string | null;
  type: OrderType;
  status: OrderStatus;
  derivedStatus: DerivedOrderStatus;
  tableId: string | null;
  coverCount: number;
  cashierId: string | null;
  customerId: string | null;
  subtotalPaisa: number;
  taxPaisa: number;
  discountPaisa: number;
  serviceChargePaisa: number;
  totalPaisa: number;
  notes: string | null;
  openedAt: string | null;
  sentToKdsAt: string | null;
  clientOrderId: string;
  version: number;
  items: OrderItem[];
}

/**
 * The single seam that combines the settlement OrderStatus with the derived
 * kitchen-progress status into the 7-state UI-SPEC "Status System" order-status value.
 * CLOSED/VOIDED/REFUNDED take precedence (post-settlement); otherwise the live
 * derivedStatus applies. Callers (StatusBadge consumers, plans 06-10) should always go
 * through this function rather than re-deriving the merge themselves.
 */
export function getOrderDisplayStatus(
  order: Pick<Order, "status" | "derivedStatus">,
): OrderDisplayStatus {
  if (order.status === "CLOSED" || order.status === "VOIDED" || order.status === "REFUNDED") {
    return order.status;
  }
  return order.derivedStatus;
}

// ── Order Management list row (POS-09) ─────────────────────────────────────────

export interface OrderSummary {
  orderId: string;
  orderNo: string | null;
  tableId: string | null;
  tableName: string | null;
  derivedStatus: DerivedOrderStatus;
  cashierId: string | null;
  coverCount: number;
  totalPaisa: number;
  openedAt: string | null;
  /** Raw settlement status (POS-24, 07.3-04/07.3-08) — distinct from `derivedStatus`. */
  settlementStatus: OrderStatus;
  /** Server-derived payment status (POS-24) — same union `derivePaymentStatus()` below produces. */
  paymentStatus: PaymentStatus;
  amountPaidPaisa: number;
  /** Total item quantity across non-CANCELLED lines (replaces the old Cover column). */
  itemQuantity: number;
  /** Distinct non-CANCELLED line count — optional secondary text alongside `itemQuantity`. */
  distinctItemCount: number;
  /**
   * Why this order is terminal and who made it so (S0-04). Null on every live order, and on a
   * terminal order the platform never recorded a reason for.
   */
  settlement: OrderSettlementDetail | null;
}

/**
 * The provenance of a VOIDED/REFUNDED order — the answer to "who did this, and why".
 *
 * `byName` is resolved server-side from the staff directory and is decoration: it can be null
 * while `byUserId` is set (directory unreachable). Render the id then, never a blank — a void
 * with no attributable actor is exactly what this gap was about.
 */
export interface OrderSettlementDetail {
  reason: string | null;
  byUserId: string | null;
  byName: string | null;
  /** ISO-8601 instant of the void/refund. */
  at: string | null;
}

/** PATCH /orders/{id}/table (assign-table, POS-24) request body. */
export interface AssignTablePayload {
  tableId: string;
}

// ── Table-centric dine-in detail (POS-10) ───────────────────────────────────────

export interface TableDetail {
  id: string;
  branchId: string;
  tableName: string;
  capacity: number;
  status: TableStatus;
  floorPlanX: number | null;
  floorPlanY: number | null;
  floorPlanShape: string | null;
  activeOrder: Order | null;
  derivedStatus: DerivedOrderStatus | null;
  cashierId: string | null;
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

// ── Instructions edit (POS-13) ───────────────────────────────────────────────────

export interface UpdateInstructionsPayload {
  notes?: string | null;
  itemNotes?: Record<string, string>;
}

// ── Till session types ────────────────────────────────────────────────────────

export type TillStatus = "OPEN" | "CLOSED";

/** Manager/owner review state — orthogonal to the OPEN/CLOSED operational lifecycle. */
export type TillReviewStatus = "PENDING_REVIEW" | "APPROVED" | "FLAGGED";

export type TillReviewActionType = "APPROVED" | "FLAGGED" | "NOTED";

export interface TillSession {
  id: string;
  branchId: string;
  cashierId: string;
  openingFloatPaisa: number;
  expectedClosingPaisa: number | null;
  declaredClosingPaisa: number | null;
  variancePaisa: number | null;
  openedAt: string | null;
  closedAt: string | null;
  status: TillStatus;
  /** Cashier's free-text note captured at close. */
  note: string | null;
  reviewStatus: TillReviewStatus;
}

/** One append-only manager review action on a till session. */
export interface TillReviewAction {
  id: string;
  tillSessionId: string;
  reviewerId: string;
  action: TillReviewActionType;
  note: string | null;
  actedAt: string;
}

export interface TillOrderLine {
  orderId: string;
  orderNo: string | null;
  status: OrderStatus;
  totalPaisa: number;
  paidPaisa: number;
}

/** Admin till-review payload: a session + every order within it + collected cash. */
export interface TillReconciliation {
  session: TillSession;
  orderCount: number;
  cashCollectedPaisa: number;
  nonCashCollectedPaisa: number;
  /** Running expected cash (openingFloat + cash collected) — non-null even while OPEN. */
  liveExpectedCashPaisa: number;
  orders: TillOrderLine[];
}

// ── Payment types ─────────────────────────────────────────────────────────────

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "LOYALTY_POINTS"
  | "BANK_TRANSFER"
  | "VOUCHER"
  /** Bill a corporate/house account instead of settling now — requires `customerAccountId`. */
  | "CHARGE_TO_ACCOUNT";

export interface PaymentEntry {
  method: PaymentMethod;
  amountPaisa: number;
  referenceNo?: string | null;
}

// ── Request types ─────────────────────────────────────────────────────────────

export interface CreateOrderPayload {
  branchId: string;
  clientOrderId: string;
  type?: OrderType;
  tableId?: string;
  coverCount?: number;
  customerId?: string;
  notes?: string;
}

export interface AddItemPayload {
  menuItemId: string;
  branchId: string;
  quantity: number;
  modifierIds?: string[];
  notes?: string;
}

export interface ApplyDiscountPayload {
  scope: "LINE" | "ORDER";
  orderItemId?: string;
  type: "FLAT" | "PERCENT";
  value: number;
}

export interface OpenTillPayload {
  branchId: string;
  openingFloatPaisa: number;
}

export interface CloseTillPayload {
  declaredClosingPaisa: number;
  note?: string;
}

export interface FlagTillPayload {
  reason: string;
}

export interface AddTillNotePayload {
  note: string;
}

export interface CloseOrderPayload {
  payments: PaymentEntry[];
}

export interface VoidOrderPayload {
  reason: string;
}

export interface RefundOrderPayload {
  refundPaisa: number;
  reason: string;
  scope: "FULL" | "PARTIAL";
}

// ── Payment status / history (POS-22/23, 07.3-01/07.3-07) ────────────────────────

/** Derived (never client-set) payment status — mirrors backend `PaymentStatus` enum. */
export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED";

/** A single persisted payment row (GET /orders/{id}/payments history read model). */
export interface OrderPayment {
  id: string;
  /** Amount applied to the bill. Never exceeds the outstanding balance. */
  amountPaisa: number;
  method: PaymentMethod;
  /** What the customer handed over — equals amountPaisa for exact and non-cash tenders. */
  tenderedPaisa: number;
  /** tenderedPaisa - amountPaisa. Cash back to the customer; always 0 for non-cash. */
  changePaisa: number;
  referenceNo: string | null;
  recordedAt: string;
}

/** POST /orders/{id}/payments request body — records ONE tender at a time. */
export interface RecordPaymentPayload {
  method: PaymentMethod;
  /** What to apply to the bill. The server caps it at the outstanding balance. */
  amountPaisa: number;
  /**
   * What the customer handed over. Omit for exact tender and for every non-cash method — the
   * server then treats it as equal to the applied amount. Over-tender is CASH-only and comes back
   * as `changePaisa` on the payment row; a card for more than the balance is rejected (422).
   */
  tenderedPaisa?: number | null;
  /** Required when `method` is CHARGE_TO_ACCOUNT — which house account to bill. */
  customerAccountId?: string | null;
  referenceNo?: string | null;
}

/**
 * Pure client-side mirror of backend `PaymentStatusDerivationService.derive()` (07.3-01).
 * `GET /orders/{id}` (OrderDto) does not carry a `paymentStatus` field — only the Order
 * Management list row (OrderSummaryDto) does — so the Charge page (07.3-07) derives it
 * itself from the payment-history sum vs `order.totalPaisa`, exactly matching the
 * server's own derivation order: REFUNDED settlement status wins over the sum; then
 * paid<=0 -> UNPAID; paid<total -> PARTIALLY_PAID; otherwise PAID (overpay clamps).
 */
export function derivePaymentStatus(
  paidPaisa: number,
  totalPaisa: number,
  settlementStatus: OrderStatus,
): PaymentStatus {
  if (settlementStatus === "REFUNDED") {
    return "REFUNDED";
  }
  if (paidPaisa <= 0) {
    return "UNPAID";
  }
  if (paidPaisa < totalPaisa) {
    return "PARTIALLY_PAID";
  }
  return "PAID";
}

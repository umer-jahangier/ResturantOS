// Domain types for POS module. Money expressed as number paisa (BIGINT on wire).
// No raw API types leak here — adapters translate from api-client schemas.

import type { TaxSource } from "@/lib/models/tax-class.model";

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

/**
 * The one place a guest-facing order-type word is spelled.
 *
 * F2: Order Management had no type on its rows at all and printed `tableName ?? "Takeaway"`, so a
 * dine-in check with no table read Takeaway while the void panel one click away — which DID have
 * the order and DID have this mapping — called the same check Dine-in. Two surfaces, one order,
 * two answers. The strings here are the ones the void panel, the charge page and the KDS card
 * already print, so the surfaces agree by construction rather than by coincidence.
 */
export function orderTypeLabel(type: OrderType): string {
  switch (type) {
    case "TAKEAWAY":
      return "Takeaway";
    case "PICKUP":
      return "Pickup";
    case "DELIVERY":
      return "Delivery";
    case "DINE_IN":
      return "Dine-in";
  }
}

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

  /**
   * The item's tax-class OVERRIDE, or null when it follows its category (F16).
   *
   * Null here is NOT "zero-rated" — it is "inherit". Round-tripped on update for the same reason
   * `taxRateCode` and `imageFileId` are: PUT is a replace and the backend reads an absent key as
   * REMOVE, so an edit that forgets this field puts the dish back on its category's rule without
   * anybody asking.
   */
  taxClassId: string | null;

  /**
   * What this item is ACTUALLY taxed at — resolved server-side, not derived here.
   *
   * `effectiveTaxRatePct` is the number the till prices the cart with. `taxRatePct` above is only
   * the item's own legacy custom rate, which is the LAST step of that resolution and is 0.00 on
   * most rows: reading it directly is what taxed a Rs 1,657.00 check at 1.5%.
   *
   * `effectiveTaxLabel` is the class's human name ("Standard rate") or null when no class
   * answered. `effectiveTaxSource` says where the answer came from, for a caption only.
   */
  effectiveTaxRatePct: number;
  effectiveTaxRateCode: string | null;
  effectiveTaxLabel: string | null;
  effectiveTaxSource: TaxSource;
}

export interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  /** The tax class every item in this category inherits, or null for no rule (F16). */
  taxClassId: string | null;
  /** That class's name and rate, carried so the screen need not join two lists. */
  taxClassName: string | null;
  taxClassRatePct: number | null;
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

/**
 * One discount taken off a check (B3).
 *
 * `amountPaisa` is what came OFF; `value` is what was ASKED for (rupees for FLAT, percent for
 * PERCENT). They diverge when the discount was bigger than what was left of the line, and a
 * screen showing only one of them cannot explain the other.
 */
export interface OrderDiscount {
  id: string;
  scope: "LINE" | "ORDER";
  orderItemId: string | null;
  /** The line's name, resolved server-side, so no screen has to hold an item lookup. */
  itemName: string | null;
  /** FLAT or PERCENT — how to read `value`, and nothing else. */
  type: string;
  /**
   * Who decided it: MANUAL for a person, PROMOTION for the automatic engine. Orthogonal to
   * `type` — an automatic discount is still priced as FLAT or PERCENT. Defaults to MANUAL for
   * rows served by a pos-service older than V30.
   */
  source: string;
  value: number | null;
  amountPaisa: number;
  /** Why. Null only on rows written before a reason was required. */
  reason: string | null;
  appliedBy: string | null;
  /** Display name at the time. Null when the staff directory was unreachable. */
  appliedByName: string | null;
  appliedAt: string | null;
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
  /**
   * F20 — the rate this check was charged at, snapshotted server-side. `0` means the branch takes
   * no service charge, and the screen must then render NO service-charge row: `Service charge
   * Rs 0.00` printed on every bill this product ever produced, for a charge no restaurant could
   * set. Never a float near money — it is only ever displayed; the paisa were computed by the
   * server via BigDecimal HALF_UP.
   */
  serviceChargePct: number;
  /** The branch's own wording for it ("Service charge", "Service fee"). Null when there is none. */
  serviceChargeLabel: string | null;
  totalPaisa: number;
  notes: string | null;
  openedAt: string | null;
  sentToKdsAt: string | null;
  clientOrderId: string;
  version: number;
  items: OrderItem[];
  /** Every discount on the check, individually. Empty on most checks. */
  discounts: OrderDiscount[];
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
  /**
   * What KIND of check this is (F2). Server-authoritative and never inferred from `tableName`:
   * a dine-in check whose table has not been assigned yet is still dine-in.
   */
  type: OrderType;
  derivedStatus: DerivedOrderStatus;
  cashierId: string | null;
  /**
   * The cashier's display name, resolved server-side from the staff directory (F2). Decoration —
   * null when the directory was unreachable, in which case render the id, never a blank.
   */
  cashierName: string | null;
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
  /**
   * Whose drawer this was, as a name — resolved server-side (F21).
   *
   * Null when the staff directory could not be reached: the name is decoration, `cashierId` is the
   * fact. Render the id as the fallback, never a blank, which reads as "nobody".
   */
  cashierName: string | null;
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
  /** Rupees for FLAT, percent for PERCENT. Never paisa — the server does the ×100. */
  value: number;
  /**
   * Why the money is being given away. REQUIRED — the server refuses anything shorter than
   * three characters, and the control refuses to submit before it does.
   */
  reason: string;
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
/** A tender taken, or the reversing row a refund writes against it (S0-01). */
export type OrderPaymentKind = "PAYMENT" | "REFUND";

export interface OrderPayment {
  id: string;
  /**
   * SIGNED money row. Positive for a tender applied to the bill (never above the outstanding
   * balance); NEGATIVE for a refund reversing one. Summing the list therefore gives the NET
   * amount held against the order, which is what every caller already wanted.
   */
  amountPaisa: number;
  method: PaymentMethod;
  /**
   * F20 — money taken ON TOP of the bill, for the staff. Never part of `amountPaisa`, so summing
   * the list still answers "what settled the bill". Zero on almost every row.
   */
  tipPaisa: number;
  /** What the customer handed over — `amountPaisa + tipPaisa + changePaisa`. */
  tenderedPaisa: number;
  /** tenderedPaisa - amountPaisa - tipPaisa. Cash back to the customer; 0 for non-cash. */
  changePaisa: number;
  /** Reference on a tender; the operator's stated reason on a refund reversal. */
  referenceNo: string | null;
  recordedAt: string;
  /**
   * Optional for the same reason `tenderedPaisa`/`changePaisa` are optional on the wire schema:
   * rows from a producer that predates the field carry none, and the absence means PAYMENT.
   * `adaptOrderPayment` always populates it, so anything that came through the repository layer
   * has it — never infer the kind from the sign of `amountPaisa`.
   */
  kind?: OrderPaymentKind;
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
  /**
   * F20 — a tip, in paisa, taken ON TOP of `amountPaisa`. It settles no part of the bill and
   * never reaches sales revenue; finance credits it to a Tips Payable liability. Refused (422) on
   * CHARGE_TO_ACCOUNT and LOYALTY_POINTS, where no money changes hands now.
   */
  tipPaisa?: number | null;
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

/**
 * What a discount will do to this check, as priced by the server that is about to do it (D-1).
 *
 * <h3>Why this crosses the wire instead of being computed here</h3>
 *
 * The discount panel used to answer this itself: `order.totalPaisa - amountOff`. `totalPaisa` is
 * tax-INCLUSIVE, so that arithmetic asserts that taking money off a bill leaves the tax alone —
 * the opposite of what the server does. Measured on ORD-20260812-0443 (subtotal Rs 1,700.00, tax
 * Rs 272.00, total Rs 1,972.00), a 10% whole-check discount previewed "new total Rs 1,802.00" and
 * applied as Rs 1,774.80: Rs 27.20 out, because the tax fell to Rs 244.80.
 *
 * The tax base is a tenant setting, an order-scope discount is allocated across lines pro-rata,
 * the service charge has its own base and its own channel rules, and the discount is clamped
 * against a headroom this panel also got wrong (Rs 213.90 quoted against Rs 208.90 applied).
 * Reimplementing any of that here creates a second implementation of a tax rule, and two
 * implementations of a tax rule drift. So the panel asks.
 */
export interface DiscountPreview {
  /** What THIS discount takes off, after the server's headroom clamp. */
  amountOffPaisa: number;
  subtotalPaisa: number;
  /** Every discount on the check afterwards, including this one. */
  discountPaisa: number;
  taxPaisa: number;
  serviceChargePaisa: number;
  /** What the guest will owe. The only number the operator reads aloud. */
  totalPaisa: number;
  previousTaxPaisa: number;
  previousServiceChargePaisa: number;
  previousTotalPaisa: number;
}

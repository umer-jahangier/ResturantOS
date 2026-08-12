// Layer-2 adapters: raw API shapes → domain models.
// The adapter layer is the only code that touches field name mapping between wire format and domain.

import { adaptTaxSource } from "@/lib/adapters/tax-class.adapter";

import type {
  ApiMenuItem,
  ApiMenuCategory,
  ApiDiningTable,
  ApiOrder,
  ApiOrderItem,
  ApiOrderSummary,
  ApiOrderPaymentRecord,
  ApiTableDetail,
  ApiTillSession,
  ApiTillReconciliation,
  ApiTillReviewAction,
  ApiStation,
} from "@/lib/api-client/schemas/pos.schema";
import type {
  MenuItem,
  MenuCategory,
  DiningTable,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderStatus,
  OrderSummary,
  OrderPayment,
  TableDetail,
  TillSession,
  TillReconciliation,
  TillReviewAction,
  Station,
  StationType,
  StationDisplayFamily,
  OrderDiscount,
} from "@/lib/models/pos.model";

export function adaptMenuItem(raw: ApiMenuItem): MenuItem {
  return {
    id: raw.id,
    categoryId: raw.categoryId ?? null,
    categoryName: raw.categoryName ?? null,
    name: raw.name,
    description: raw.description ?? null,
    basePricePaisa: raw.basePricePaisa,
    taxRatePct: typeof raw.taxRatePct === "number" ? raw.taxRatePct : Number(raw.taxRatePct),
    taxRateCode: raw.taxRateCode ?? null,
    kdsStation: raw.kdsStation ?? null,
    active: raw.active,
    imageFileId: raw.imageFileId ?? null,
    imageUrl: raw.imageUrl ?? null,
    taxClassId: raw.taxClassId ?? null,
    // F16. The fallback is the item's OWN legacy rate, not zero: a pos-service that predates
    // F16 sends no `effectiveTaxRatePct`, and every one of its items is priced from
    // `taxRatePct`. Defaulting to 0 there would silently stop charging tax against an older
    // backend — the failure this whole item exists to end, caused by the client this time.
    effectiveTaxRatePct:
      raw.effectiveTaxRatePct ??
      (typeof raw.taxRatePct === "number" ? raw.taxRatePct : Number(raw.taxRatePct)),
    effectiveTaxRateCode: raw.effectiveTaxRateCode ?? raw.taxRateCode ?? null,
    effectiveTaxLabel: raw.effectiveTaxLabel ?? null,
    effectiveTaxSource: adaptTaxSource(raw.effectiveTaxSource),
  };
}

export function adaptMenuCategory(raw: ApiMenuCategory): MenuCategory {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    sortOrder: raw.sortOrder,
    active: raw.active,
    taxClassId: raw.taxClassId ?? null,
    taxClassName: raw.taxClassName ?? null,
    taxClassRatePct: raw.taxClassRatePct ?? null,
  };
}

export function adaptDiningTable(raw: ApiDiningTable): DiningTable {
  return {
    id: raw.id,
    branchId: raw.branchId,
    tableName: raw.tableName,
    capacity: raw.capacity,
    section: raw.section ?? null,
    // Defaults to TRUE, not false. A pos-service that predates V12 omits this field, and
    // defaulting to false would render every table in the product as retired — the exact
    // "the screen looks empty and nothing errored" failure mode this phase exists to avoid.
    active: raw.active ?? true,
    status: raw.status,
    floorPlanX: raw.floorPlanX ?? null,
    floorPlanY: raw.floorPlanY ?? null,
    floorPlanShape: raw.floorPlanShape ?? null,
  };
}

// ── Stations (phase 28) ───────────────────────────────────────────────────────────────────

const STATION_TYPE_SET = new Set<StationType>(["KITCHEN", "BAR", "PANTRY", "EXPO", "DESSERT"]);

/**
 * Five types to three screens. This is a FALLBACK only — `StationDto` sends `displayFamily`
 * alongside the type precisely so the browser does not hold a second copy of this table.
 * It is consulted when the server sent a type and no family, which only a pos-service that
 * predates plan 28-02 does. If a sixth type is ever added, the server's answer keeps arriving
 * and this map is not the thing that decides.
 */
const DISPLAY_FAMILY_FALLBACK: Record<StationType, StationDisplayFamily> = {
  KITCHEN: "KITCHEN",
  BAR: "BAR",
  PANTRY: "KITCHEN",
  EXPO: "EXPO",
  DESSERT: "KITCHEN",
};

/**
 * TOLERANT ON PURPOSE — do not "tighten" this into a throw.
 *
 * <p>An absent or unrecognised `stationType` becomes KITCHEN, which is the type every station
 * that existed before phase 28 already has (V14's `DEFAULT 'KITCHEN'`). A browser deployed a
 * few minutes ahead of pos-service, or pointed at an instance mid-rolling-restart, receives
 * responses without the field; throwing there would empty the one screen whose job is to say
 * which stations exist, and an empty catalogue reads as "you have no stations" rather than as
 * a version skew.
 */
export function adaptStation(raw: ApiStation): Station {
  const type = raw.stationType?.toUpperCase();
  const stationType: StationType =
    type && STATION_TYPE_SET.has(type as StationType) ? (type as StationType) : "KITCHEN";

  const family = raw.displayFamily?.toUpperCase();
  const displayFamily: StationDisplayFamily =
    family === "KITCHEN" || family === "BAR" || family === "EXPO"
      ? family
      : DISPLAY_FAMILY_FALLBACK[stationType];

  return {
    id: raw.id,
    branchId: raw.branchId,
    code: raw.code,
    name: raw.name,
    stationType,
    displayFamily,
    // Defaults to TRUE for the same reason `adaptDiningTable` does: an absent flag rendering
    // every station as retired is the "screen looks empty and nothing errored" failure.
    active: raw.active ?? true,
  };
}

export function adaptOrderItemModifier(
  raw: ApiOrder["items"][number]["modifiers"][number],
): OrderItemModifier {
  return {
    id: raw.id,
    modifierId: raw.modifierId ?? null,
    modifierNameSnapshot: raw.modifierNameSnapshot,
    priceDeltaPaisa: raw.priceDeltaPaisa,
  };
}

export function adaptOrderItem(raw: ApiOrderItem): OrderItem {
  return {
    id: raw.id,
    menuItemId: raw.menuItemId,
    itemNameSnapshot: raw.itemNameSnapshot,
    unitPriceSnapshot: raw.unitPriceSnapshot,
    quantity: raw.quantity,
    kdsStation: raw.kdsStation ?? null,
    // Wire field `kdsStatus` -> domain field `itemStatus` (clearer name; see
    // pos.schema.ts comment on apiOrderItemSchema).
    itemStatus: raw.kdsStatus,
    // See the `.optional()` comment on apiOrderItemSchema — default to 0 ("not yet
    // fired"), matching the backend entity's own default for an omitted value.
    revisionNo: raw.revisionNo ?? 0,
    firedAt: raw.firedAt ?? null,
    discountPaisa: raw.discountPaisa,
    taxPaisa: raw.taxPaisa,
    lineTotalPaisa: raw.lineTotalPaisa,
    notes: raw.notes ?? null,
    modifiers: raw.modifiers.map(adaptOrderItemModifier),
  };
}

/**
 * One discount, ready to render. `reason` and the actor are carried all the way to the screen
 * on purpose: a "Discounts Rs 99.80" line nobody can question is how a discount control becomes
 * a hole in the till.
 */
export function adaptOrderDiscount(raw: ApiOrder["discounts"][number]): OrderDiscount {
  return {
    id: raw.id,
    scope: raw.scope,
    orderItemId: raw.orderItemId ?? null,
    itemName: raw.itemName ?? null,
    type: raw.type,
    value: raw.value === null || raw.value === undefined ? null : Number(raw.value),
    amountPaisa: raw.amountPaisa,
    reason: raw.reason ?? null,
    appliedBy: raw.appliedBy ?? null,
    appliedByName: raw.appliedByName ?? null,
    appliedAt: raw.appliedAt ?? null,
  };
}

export function adaptOrder(raw: ApiOrder): Order {
  return {
    id: raw.id,
    branchId: raw.branchId,
    orderNo: raw.orderNo ?? null,
    type: raw.type,
    status: raw.status,
    // See the `.optional()` comment on apiOrderSchema — the live backend omits this
    // field today; default to the same DRAFT value the backend entity itself defaults
    // to, rather than propagating `undefined` into a domain type declared non-nullable.
    derivedStatus: raw.derivedStatus ?? "DRAFT",
    tableId: raw.tableId ?? null,
    coverCount: raw.coverCount,
    cashierId: raw.cashierId ?? null,
    customerId: raw.customerId ?? null,
    subtotalPaisa: raw.subtotalPaisa,
    taxPaisa: raw.taxPaisa,
    discountPaisa: raw.discountPaisa,
    serviceChargePaisa: raw.serviceChargePaisa,
    // F20. A pos-service that predates the snapshot sends neither field; the honest reading of
    // that absence is "no service charge on this check", which is also what every order written
    // before F20 actually was. Number() because Jackson may serialise a BigDecimal either way.
    serviceChargePct: raw.serviceChargePct == null ? 0 : Number(raw.serviceChargePct),
    serviceChargeLabel: raw.serviceChargeLabel ?? null,
    totalPaisa: raw.totalPaisa,
    notes: raw.notes ?? null,
    openedAt: raw.openedAt ?? null,
    sentToKdsAt: raw.sentToKdsAt ?? null,
    clientOrderId: raw.clientOrderId,
    version: raw.version,
    items: raw.items.map(adaptOrderItem),
    discounts: (raw.discounts ?? []).map(adaptOrderDiscount),
  };
}

export function adaptOrderSummary(raw: ApiOrderSummary): OrderSummary {
  return {
    orderId: raw.orderId,
    orderNo: raw.orderNo ?? null,
    tableId: raw.tableId ?? null,
    tableName: raw.tableName ?? null,
    type: raw.type,
    derivedStatus: raw.derivedStatus,
    cashierId: raw.cashierId ?? null,
    cashierName: raw.cashierName ?? null,
    coverCount: raw.coverCount,
    totalPaisa: raw.totalPaisa,
    openedAt: raw.openedAt ?? null,
    settlementStatus: raw.settlementStatus,
    paymentStatus: raw.paymentStatus,
    amountPaidPaisa: raw.amountPaidPaisa,
    itemQuantity: raw.itemQuantity,
    distinctItemCount: raw.distinctItemCount,
    settlement: raw.settlement
      ? {
          reason: raw.settlement.reason ?? null,
          byUserId: raw.settlement.byUserId ?? null,
          byName: raw.settlement.byName ?? null,
          at: raw.settlement.at ?? null,
        }
      : null,
  };
}

export function adaptTableDetail(raw: ApiTableDetail): TableDetail {
  return {
    id: raw.id,
    branchId: raw.branchId,
    tableName: raw.tableName,
    capacity: raw.capacity,
    status: raw.status,
    floorPlanX: raw.floorPlanX ?? null,
    floorPlanY: raw.floorPlanY ?? null,
    floorPlanShape: raw.floorPlanShape ?? null,
    activeOrder: raw.activeOrder ? adaptOrder(raw.activeOrder) : null,
    derivedStatus: raw.derivedStatus ?? null,
    cashierId: raw.cashierId ?? null,
    subtotalPaisa: raw.subtotalPaisa,
    discountPaisa: raw.discountPaisa,
    taxPaisa: raw.taxPaisa,
    totalPaisa: raw.totalPaisa,
  };
}

export function adaptOrderPayment(raw: ApiOrderPaymentRecord): OrderPayment {
  return {
    id: raw.id,
    method: raw.method,
    amountPaisa: raw.amountPaisa,
    // F20. Rows written before the tip column carry no tip, which is what they were.
    tipPaisa: raw.tipPaisa ?? 0,
    // Rows written before the V10 migration carry neither field; treat them as exact tender,
    // which is what they were.
    tenderedPaisa: raw.tenderedPaisa ?? raw.amountPaisa,
    changePaisa: raw.changePaisa ?? 0,
    referenceNo: raw.referenceNo ?? null,
    recordedAt: raw.recordedAt,
    // S0-01. A server that predates the refund-reversal rows only ever returns tenders, so the
    // absent-field default is PAYMENT and never a guess from the sign of the amount.
    kind: raw.kind ?? "PAYMENT",
  };
}

export function adaptTillSession(raw: ApiTillSession): TillSession {
  return {
    id: raw.id,
    branchId: raw.branchId,
    cashierId: raw.cashierId,
    openingFloatPaisa: raw.openingFloatPaisa,
    expectedClosingPaisa: raw.expectedClosingPaisa ?? null,
    declaredClosingPaisa: raw.declaredClosingPaisa ?? null,
    variancePaisa: raw.variancePaisa ?? null,
    openedAt: raw.openedAt ?? null,
    closedAt: raw.closedAt ?? null,
    status: raw.status,
    note: raw.note ?? null,
    reviewStatus: raw.reviewStatus,
  };
}

export function adaptTillReviewAction(raw: ApiTillReviewAction): TillReviewAction {
  return {
    id: raw.id,
    tillSessionId: raw.tillSessionId,
    reviewerId: raw.reviewerId,
    action: raw.action,
    note: raw.note ?? null,
    actedAt: raw.actedAt,
  };
}

export function adaptTillReconciliation(raw: ApiTillReconciliation): TillReconciliation {
  return {
    session: adaptTillSession(raw.session),
    orderCount: raw.orderCount,
    cashCollectedPaisa: raw.cashCollectedPaisa,
    nonCashCollectedPaisa: raw.nonCashCollectedPaisa,
    liveExpectedCashPaisa: raw.liveExpectedCashPaisa,
    orders: raw.orders.map((o) => ({
      orderId: o.orderId,
      orderNo: o.orderNo ?? null,
      status: o.status as OrderStatus,
      totalPaisa: o.totalPaisa,
      paidPaisa: o.paidPaisa,
    })),
  };
}

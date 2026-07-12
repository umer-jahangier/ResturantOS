// Layer-2 adapters: raw API shapes → domain models.
// The adapter layer is the only code that touches field name mapping between wire format and domain.

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
} from "@/lib/api-client/schemas/pos.schema";
import type {
  MenuItem,
  MenuCategory,
  DiningTable,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderSummary,
  OrderPayment,
  TableDetail,
  TillSession,
} from "@/lib/models/pos.model";

export function adaptMenuItem(raw: ApiMenuItem): MenuItem {
  return {
    id: raw.id,
    categoryId: raw.categoryId ?? null,
    name: raw.name,
    description: raw.description ?? null,
    basePricePaisa: raw.basePricePaisa,
    taxRatePct: typeof raw.taxRatePct === "number" ? raw.taxRatePct : Number(raw.taxRatePct),
    kdsStation: raw.kdsStation ?? null,
    active: raw.active,
  };
}

export function adaptMenuCategory(raw: ApiMenuCategory): MenuCategory {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    sortOrder: raw.sortOrder,
    active: raw.active,
  };
}

export function adaptDiningTable(raw: ApiDiningTable): DiningTable {
  return {
    id: raw.id,
    branchId: raw.branchId,
    tableName: raw.tableName,
    capacity: raw.capacity,
    status: raw.status,
    floorPlanX: raw.floorPlanX ?? null,
    floorPlanY: raw.floorPlanY ?? null,
    floorPlanShape: raw.floorPlanShape ?? null,
  };
}

export function adaptOrderItemModifier(raw: ApiOrder["items"][number]["modifiers"][number]): OrderItemModifier {
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
    totalPaisa: raw.totalPaisa,
    notes: raw.notes ?? null,
    openedAt: raw.openedAt ?? null,
    sentToKdsAt: raw.sentToKdsAt ?? null,
    clientOrderId: raw.clientOrderId,
    version: raw.version,
    items: raw.items.map(adaptOrderItem),
  };
}

export function adaptOrderSummary(raw: ApiOrderSummary): OrderSummary {
  return {
    orderId: raw.orderId,
    orderNo: raw.orderNo ?? null,
    tableId: raw.tableId ?? null,
    tableName: raw.tableName ?? null,
    derivedStatus: raw.derivedStatus,
    cashierId: raw.cashierId ?? null,
    coverCount: raw.coverCount,
    totalPaisa: raw.totalPaisa,
    openedAt: raw.openedAt ?? null,
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
    referenceNo: raw.referenceNo ?? null,
    recordedAt: raw.recordedAt,
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
  };
}

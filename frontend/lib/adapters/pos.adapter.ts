// Layer-2 adapters: raw API shapes → domain models.
// The adapter layer is the only code that touches field name mapping between wire format and domain.

import type {
  ApiMenuItem,
  ApiMenuCategory,
  ApiDiningTable,
  ApiOrder,
  ApiOrderItem,
  ApiTillSession,
} from "@/lib/api-client/schemas/pos.schema";
import type {
  MenuItem,
  MenuCategory,
  DiningTable,
  Order,
  OrderItem,
  OrderItemModifier,
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
    kdsStatus: raw.kdsStatus,
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

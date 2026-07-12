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
  name: string;
  description: string | null;
  basePricePaisa: number;
  taxRatePct: number;
  kdsStation: string | null;
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
  status: TableStatus;
  floorPlanX: number | null;
  floorPlanY: number | null;
  floorPlanShape: string | null;
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
}

// ── Payment types ─────────────────────────────────────────────────────────────

export type PaymentMethod = "CASH" | "CARD" | "LOYALTY_POINTS" | "BANK_TRANSFER" | "VOUCHER";

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

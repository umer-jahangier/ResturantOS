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

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

export type KdsItemStatus = "PENDING" | "COOKING" | "READY";

export type TableStatus = "AVAILABLE" | "OCCUPIED";

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
  kdsStatus: KdsItemStatus;
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

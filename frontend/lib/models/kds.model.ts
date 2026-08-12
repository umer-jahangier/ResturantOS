// Domain types for KDS module.
// All timestamps expressed as Date (adapters parse ISO strings → Date).
// No raw API types leak here — adapters translate from api-client schemas.

// CLEARED (F17): a cook took the ticket off the board because the business day it was received
// on had already closed. Terminal for the active board, and deliberately NOT spelled as SERVED
// (nobody handed the food over) or CANCELLED (the order was not voided — it may still be open).
export type KdsTicketStatus = "PENDING" | "COOKING" | "READY" | "SERVED" | "CANCELLED" | "CLEARED";
// Kitchen-owned per-item lifecycle subset (backend TicketItemStatus). COOKING is a
// retained legacy alias for PREPARING (see kds.schema.ts comment). CANCELLED = pos cancelled
// the line after it was fired.
// SERVED mirrors the kitchen-side terminal state set by the ORDER_ITEM_SERVED consumer: a line
// served on the POS while the order is still open. It maps to no board column (mapItemStatusToColumn
// returns null via its default case), so a served line drops off the board like a cancelled one.
export type KdsItemStatus =
  | "PENDING"
  | "ACCEPTED"
  | "PREPARING"
  | "COOKING"
  | "READY"
  | "CANCELLED"
  | "SERVED";

export interface KdsTicketItem {
  id: string;
  orderItemId: string;
  name: string;
  qty: number;
  modifiers: string[];
  notes: string | null;
  status: KdsItemStatus;
  revisionNo: number;
  firedAt: string | null;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  orderNo: string | null;
  stationCode: string;
  status: KdsTicketStatus;
  priority: boolean;
  receivedAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  /** When a person cleared this off the board (F17). Null on every ticket that left another way. */
  clearedAt: Date | null;
  /** Order-level "Kitchen Notes" callout (UI-SPEC §6). Currently always null — backend
   * KdsTicketDto does not emit this field yet (known gap, see 07.1-05 SUMMARY). */
  orderNotes: string | null;
  /** Table number (07.3-05, KDS-04) — null for takeaway/pickup orders with no table. */
  tableNumber: string | null;
  /** Service type (DINE_IN/TAKEAWAY/DELIVERY/PICKUP) — null for legacy tickets. */
  orderType: string | null;
  items: KdsTicketItem[];
}

/**
 * One ticket on this board from a business day that has already closed (F17).
 * `businessDate` is the trading day it belongs to, resolved server-side on the BRANCH's zone —
 * never re-derived here, because a second implementation of that formula is how three services
 * came to disagree about which day a sale happened on.
 */
export interface KdsStaleTicket {
  id: string;
  orderNo: string | null;
  stationCode: string;
  tableNumber: string | null;
  orderType: string | null;
  status: KdsTicketStatus;
  receivedAt: Date;
  businessDate: string;
  itemCount: number;
}

export interface KdsStaleBoardSummary {
  branchId: string;
  /** The board this describes; null means every station at the branch. */
  stationCode: string | null;
  /** The IANA zone the boundary was cut on. Printed on the confirmation, not implied. */
  branchTimezone: string;
  businessDayOffsetHours: number;
  currentBusinessDate: string;
  /** The exact instant today's trading day began — every ticket below predates it. */
  currentBusinessDayStartedAt: Date;
  ticketCount: number;
  itemCount: number;
  /** Stale tickets with no line left to cook: finished, but their order never closed. */
  finishedTicketCount: number;
  oldestReceivedAt: Date | null;
  days: { businessDate: string; ticketCount: number }[];
  tickets: KdsStaleTicket[];
}

export interface KdsClearStaleResult {
  branchId: string;
  stationCode: string | null;
  branchTimezone: string;
  currentBusinessDate: string;
  currentBusinessDayStartedAt: Date;
  clearedTicketCount: number;
  clearedItemCount: number;
  oldestClearedReceivedAt: Date | null;
  clearedAt: Date;
  clearedTicketIds: string[];
}

export interface KdsStation {
  id: string;
  branchId: string;
  code: string;
  name: string;
  active: boolean;
  escalationThresholdSeconds: number;
}

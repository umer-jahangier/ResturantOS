// Domain types for KDS module.
// All timestamps expressed as Date (adapters parse ISO strings → Date).
// No raw API types leak here — adapters translate from api-client schemas.

export type KdsTicketStatus = "PENDING" | "COOKING" | "READY" | "CANCELLED";
export type KdsItemStatus = "PENDING" | "COOKING" | "READY";

export interface KdsTicketItem {
  id: string;
  orderItemId: string;
  name: string;
  qty: number;
  modifiers: string[];
  notes: string | null;
  status: KdsItemStatus;
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
  items: KdsTicketItem[];
}

export interface KdsStation {
  id: string;
  branchId: string;
  code: string;
  name: string;
  active: boolean;
  escalationThresholdSeconds: number;
}

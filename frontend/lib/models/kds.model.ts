// Domain types for KDS module.
// All timestamps expressed as Date (adapters parse ISO strings → Date).
// No raw API types leak here — adapters translate from api-client schemas.

export type KdsTicketStatus = "PENDING" | "COOKING" | "READY" | "CANCELLED";
// Kitchen-owned per-item lifecycle subset (backend TicketItemStatus). COOKING is a
// retained legacy alias for PREPARING (see kds.schema.ts comment).
export type KdsItemStatus = "PENDING" | "ACCEPTED" | "PREPARING" | "COOKING" | "READY";

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
  /** Order-level "Kitchen Notes" callout (UI-SPEC §6). Currently always null — backend
   * KdsTicketDto does not emit this field yet (known gap, see 07.1-05 SUMMARY). */
  orderNotes: string | null;
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

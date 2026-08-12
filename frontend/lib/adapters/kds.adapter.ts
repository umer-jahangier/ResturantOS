// Layer-2 adapters: raw API shapes → domain models.
// The adapter layer is the only code that touches field name mapping between wire format and domain.

import type {
  ApiKdsTicket,
  ApiKdsTicketItem,
  ApiKdsStation,
  ApiStaleBoardSummary,
  ApiClearStaleResult,
} from "@/lib/api-client/schemas/kds.schema";
import type {
  KdsTicket,
  KdsTicketItem,
  KdsStation,
  KdsStaleBoardSummary,
  KdsClearStaleResult,
} from "@/lib/models/kds.model";

export function adaptKdsTicketItem(raw: ApiKdsTicketItem): KdsTicketItem {
  return {
    id: raw.id,
    orderItemId: raw.orderItemId,
    name: raw.name,
    qty: raw.qty,
    modifiers: raw.modifiers ?? [],
    notes: raw.notes ?? null,
    status: raw.status,
    revisionNo: raw.revisionNo,
    firedAt: raw.firedAt ?? null,
  };
}

export function adaptKdsTicket(raw: ApiKdsTicket): KdsTicket {
  return {
    id: raw.id,
    orderId: raw.orderId,
    orderNo: raw.orderNo ?? null,
    stationCode: raw.stationCode,
    status: raw.status,
    priority: raw.priority,
    receivedAt: new Date(raw.receivedAt),
    startedAt: raw.startedAt ? new Date(raw.startedAt) : null,
    readyAt: raw.readyAt ? new Date(raw.readyAt) : null,
    clearedAt: raw.clearedAt ? new Date(raw.clearedAt) : null,
    orderNotes: raw.orderNotes ?? null,
    tableNumber: raw.tableNumber ?? null,
    orderType: raw.orderType ?? null,
    items: raw.items.map(adaptKdsTicketItem),
  };
}

export function adaptStaleBoardSummary(raw: ApiStaleBoardSummary): KdsStaleBoardSummary {
  return {
    branchId: raw.branchId,
    stationCode: raw.stationCode ?? null,
    branchTimezone: raw.branchTimezone,
    businessDayOffsetHours: raw.businessDayOffsetHours,
    currentBusinessDate: raw.currentBusinessDate,
    currentBusinessDayStartedAt: new Date(raw.currentBusinessDayStartedAt),
    ticketCount: raw.ticketCount,
    itemCount: raw.itemCount,
    finishedTicketCount: raw.finishedTicketCount,
    oldestReceivedAt: raw.oldestReceivedAt ? new Date(raw.oldestReceivedAt) : null,
    days: raw.days.map((d) => ({ businessDate: d.businessDate, ticketCount: d.ticketCount })),
    tickets: raw.tickets.map((t) => ({
      id: t.id,
      orderNo: t.orderNo ?? null,
      stationCode: t.stationCode,
      tableNumber: t.tableNumber ?? null,
      orderType: t.orderType ?? null,
      status: t.status,
      receivedAt: new Date(t.receivedAt),
      businessDate: t.businessDate,
      itemCount: t.itemCount,
    })),
  };
}

export function adaptClearStaleResult(raw: ApiClearStaleResult): KdsClearStaleResult {
  return {
    branchId: raw.branchId,
    stationCode: raw.stationCode ?? null,
    branchTimezone: raw.branchTimezone,
    currentBusinessDate: raw.currentBusinessDate,
    currentBusinessDayStartedAt: new Date(raw.currentBusinessDayStartedAt),
    clearedTicketCount: raw.clearedTicketCount,
    clearedItemCount: raw.clearedItemCount,
    oldestClearedReceivedAt: raw.oldestClearedReceivedAt
      ? new Date(raw.oldestClearedReceivedAt)
      : null,
    clearedAt: new Date(raw.clearedAt),
    clearedTicketIds: raw.clearedTicketIds,
  };
}

export function adaptKdsStation(raw: ApiKdsStation): KdsStation {
  return {
    id: raw.id,
    branchId: raw.branchId,
    code: raw.code,
    name: raw.name,
    active: raw.active,
    escalationThresholdSeconds: raw.escalationThresholdSeconds,
  };
}

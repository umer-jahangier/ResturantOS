// Layer-2 adapters: raw API shapes → domain models.
// The adapter layer is the only code that touches field name mapping between wire format and domain.

import type { ApiKdsTicket, ApiKdsTicketItem, ApiKdsStation } from "@/lib/api-client/schemas/kds.schema";
import type { KdsTicket, KdsTicketItem, KdsStation } from "@/lib/models/kds.model";

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
    orderNotes: raw.orderNotes ?? null,
    tableNumber: raw.tableNumber ?? null,
    items: raw.items.map(adaptKdsTicketItem),
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

"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { useUpdateItemStatus } from "@/lib/hooks/kds/use-kds-tickets";
import type { KdsItemStatus, KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

// Station-isolated item-status columns (KDS-04/D-12). A column is just a grouping
// of item rows by mapped TicketItemStatus — item-centric, so a mixed-status order
// shows a fragment in each relevant column.

export type KdsColumnKey = "NEW" | "STARTED" | "PREPARING" | "READY";

export const KDS_COLUMN_ORDER: readonly KdsColumnKey[] = ["NEW", "STARTED", "PREPARING", "READY"];

export const KDS_COLUMN_LABELS: Record<KdsColumnKey, string> = {
  NEW: "New",
  STARTED: "Started",
  PREPARING: "Preparing",
  READY: "Ready",
};

/**
 * Maps a kitchen-owned item status to its board column: New=PENDING,
 * Started=ACCEPTED, Preparing=PREPARING (+ legacy COOKING), Ready=READY.
 * Registry Safety: an unmapped/unrecognized value returns `null` rather than
 * throwing (never crashes the board on an unexpected status).
 */
export function mapItemStatusToColumn(status: KdsItemStatus): KdsColumnKey | null {
  switch (status) {
    case "PENDING":
      return "NEW";
    case "ACCEPTED":
      return "STARTED";
    case "PREPARING":
    case "COOKING":
      return "PREPARING";
    case "READY":
      return "READY";
    default:
      return null;
  }
}

/**
 * Target status for a column's "move forward" action (New→Started→Preparing→
 * Ready), mirroring kitchen-service's validateTransition. Returns `null` when the
 * item is already terminal (READY) or unrecognized — no move action is offered.
 */
export function getNextItemStatus(status: KdsItemStatus): KdsItemStatus | null {
  switch (status) {
    case "PENDING":
      return "ACCEPTED";
    case "ACCEPTED":
      return "PREPARING";
    case "PREPARING":
    case "COOKING":
      return "READY";
    case "READY":
      return null;
    default:
      return null;
  }
}

export interface KdsColumnFragment {
  ticket: KdsTicket;
  items: KdsTicketItem[];
}

/**
 * Item-centric grouping (KDS-04): an order with mixed item statuses appears in
 * EACH relevant column, each fragment carrying only that column's items (never
 * merged into a single "whole order" card).
 */
export function groupTicketsByColumn(
  tickets: readonly KdsTicket[],
  column: KdsColumnKey,
): KdsColumnFragment[] {
  const fragments: KdsColumnFragment[] = [];
  for (const ticket of tickets) {
    const items = ticket.items.filter((item) => mapItemStatusToColumn(item.status) === column);
    if (items.length > 0) fragments.push({ ticket, items });
  }
  return fragments;
}

interface KdsItemColumnProps {
  column: KdsColumnKey;
  tickets: readonly KdsTicket[];
  branchId: string;
  canUpdate: boolean;
}

/**
 * One New/Started/Preparing/Ready board column (KDS-04/D-12). Each fragment's
 * collapsed card (order#/table/age/item-names) opens the dedicated ticket detail
 * page on click; canUpdate principals get a per-item move action calling
 * useUpdateItemStatus with the column's next target status (server still
 * authoritatively validates the transition, T-07.3-30).
 */
export function KdsItemColumn({ column, tickets, branchId, canUpdate }: KdsItemColumnProps) {
  const router = useRouter();
  const updateItemStatus = useUpdateItemStatus(branchId);
  const fragments = useMemo(() => groupTicketsByColumn(tickets, column), [tickets, column]);

  return (
    <div className="flex flex-col gap-2 min-w-0" data-testid={`kds-column-${column}`}>
      <div className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
        <h3 className="text-white font-bold text-sm uppercase tracking-wide">
          {KDS_COLUMN_LABELS[column]}
        </h3>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {fragments.length === 0 ? (
          <div className="text-center text-gray-600 py-6 text-xs">—</div>
        ) : (
          fragments.map(({ ticket, items }) => (
            <div
              key={ticket.id}
              className="rounded-lg border border-gray-800 bg-gray-900 p-2"
              data-testid={`kds-fragment-${column}-${ticket.id}`}
            >
              <button
                type="button"
                onClick={() => router.push(`/app/kitchen/${ticket.stationCode}/orders/${ticket.id}`)}
                className="w-full text-left"
                aria-label={`Open ticket detail for ${ticket.orderNo ?? ticket.id.slice(0, 8)}`}
              >
                <KdsTicketCard ticket={ticket} items={items} />
              </button>
              {canUpdate && (
                <div className="mt-2 flex flex-col gap-1">
                  {items.map((item) => {
                    const nextStatus = getNextItemStatus(item.status);
                    if (!nextStatus) return null;
                    const nextColumn = mapItemStatusToColumn(nextStatus) ?? column;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`column-move-${item.id}`}
                        onClick={() =>
                          updateItemStatus.mutate({
                            ticketId: ticket.id,
                            itemId: item.id,
                            status: nextStatus,
                          })
                        }
                        className="text-xs font-bold px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                      >
                        {item.name} → {KDS_COLUMN_LABELS[nextColumn]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

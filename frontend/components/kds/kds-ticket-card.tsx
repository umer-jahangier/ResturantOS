"use client";

import { useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

interface KdsTicketCardProps {
  ticket: KdsTicket;
  /**
   * Items to render in the item-name list — defaults to `ticket.items`. Column
   * fragments (kds-item-column.tsx) pass only that column's items so a
   * mixed-status order's card fragment shows just the relevant subset (KDS-04,
   * item-centric board).
   */
  items?: KdsTicketItem[];
  /** Extra classes applied to the outer element — used by callers (e.g. the aging
   * border + timer chip wrapper in kds-item-column.tsx / kds-station-detail.tsx). */
  className?: string;
}

function formatItemNames(items: KdsTicketItem[]): string {
  return items.map((item) => (item.qty > 1 ? `×${item.qty} ${item.name}` : item.name)).join(", ");
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m";
  return `${minutes}m`;
}

/**
 * Collapsed KDS ticket card (KDS-04/D-12) — slimmed to ONLY order number, table,
 * time (age), and menu-item names. No inline status badges or bump buttons: those
 * moved into kds-item-column.tsx's per-item move action and the detail page
 * (kds-station-detail.tsx). Age is driven by the shared useKdsClock (KDS-05/D-13)
 * instead of a per-card setInterval.
 */
export function KdsTicketCard({ ticket, items, className }: KdsTicketCardProps) {
  const now = useKdsClock();
  const ageMs = now - ticket.receivedAt.getTime();
  const displayItems = items ?? ticket.items;

  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`} data-testid="kds-ticket-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-200 text-sm font-bold uppercase tracking-wide">
          {ticket.orderNo ?? ticket.id.slice(0, 8)}
        </span>
        <span className="text-gray-500 text-xs" data-testid="kds-ticket-age">
          {formatAge(ageMs)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{ticket.tableNumber ? `Table ${ticket.tableNumber}` : "No table"}</span>
        {ticket.priority && (
          <span className="text-xs bg-red-600 text-white px-1.5 py-0.5 rounded font-bold">
            PRIORITY
          </span>
        )}
      </div>
      <div className="text-sm text-gray-100 truncate">{formatItemNames(displayItems)}</div>
    </div>
  );
}

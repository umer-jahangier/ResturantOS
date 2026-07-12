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
  /** Extra classes applied to the outer element. */
  className?: string;
  /**
   * The ticket's station `escalationThresholdSeconds` (KDS-05/D-13) — drives the
   * subtle left-border color + timer-chip color. Falls back to a 15-minute
   * default when the station hasn't loaded yet (matches the old red threshold).
   */
  escalationThresholdSeconds?: number;
}

const DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900; // 15 minutes

function formatItemNames(items: KdsTicketItem[]): string {
  return items.map((item) => (item.qty > 1 ? `×${item.qty} ${item.name}` : item.name)).join(", ");
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m";
  return `${minutes}m`;
}

interface AgingTreatment {
  borderColorClass: string;
  chipClass: string;
}

/**
 * Subtle escalation-threshold-driven aging treatment (KDS-05/D-13) — replaces the
 * pre-07.3-10 `getAgingClasses`'s aggressive full-screen-style bounce/full-red
 * escalation. A colored left border + a timer chip that turns amber at 0.66x the
 * station's escalationThresholdSeconds, red at 1.0x. No full-screen/aggressive
 * effects.
 */
function getAgingTreatment(ageMs: number, escalationThresholdSeconds: number): AgingTreatment {
  const fraction = ageMs / (escalationThresholdSeconds * 1000);
  if (fraction >= 1) {
    return { borderColorClass: "border-l-red-500", chipClass: "bg-red-500/15 text-red-300" };
  }
  if (fraction >= 0.66) {
    return { borderColorClass: "border-l-amber-500", chipClass: "bg-amber-500/15 text-amber-300" };
  }
  return { borderColorClass: "border-l-emerald-500/60", chipClass: "bg-gray-800 text-gray-400" };
}

/**
 * Collapsed KDS ticket card (KDS-04/D-12) — slimmed to ONLY order number, table,
 * time (age), and menu-item names. No inline status badges or bump buttons: those
 * moved into kds-item-column.tsx's per-item move action and the detail page
 * (kds-station-detail.tsx). No Dialog anywhere — selecting a card is the caller's
 * responsibility (routes to the dedicated detail page). Age and the aging
 * treatment are driven by the shared useKdsClock (KDS-05/D-13) instead of a
 * per-card setInterval.
 */
export function KdsTicketCard({
  ticket,
  items,
  className,
  escalationThresholdSeconds,
}: KdsTicketCardProps) {
  const now = useKdsClock();
  const ageMs = now - ticket.receivedAt.getTime();
  const displayItems = items ?? ticket.items;
  const { borderColorClass, chipClass } = getAgingTreatment(
    ageMs,
    escalationThresholdSeconds ?? DEFAULT_ESCALATION_THRESHOLD_SECONDS,
  );

  return (
    <div
      className={`flex flex-col gap-1 border-l-4 pl-2 ${borderColorClass} ${className ?? ""}`}
      data-testid="kds-ticket-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-200 text-sm font-bold uppercase tracking-wide">
          {ticket.orderNo ?? ticket.id.slice(0, 8)}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${chipClass}`}
          data-testid="kds-ticket-age"
        >
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

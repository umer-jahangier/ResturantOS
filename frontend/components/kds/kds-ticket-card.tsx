"use client";

import { useEffect, useState } from "react";
import { useBumpItem } from "@/lib/hooks/kds/use-kds-tickets";
import { StatusBadge, type LineItemStatusVariant } from "@/components/ui/status-badge";
import { RevisionBadge } from "@/components/pos/revision-chip";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KdsTicketDetail } from "@/components/kds/kds-ticket-detail";
import type { KdsItemStatus, KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

interface KdsTicketCardProps {
  ticket: KdsTicket;
  branchId: string;
  canUpdate: boolean;
}

function useTicketAge(receivedAt: Date): number {
  const [ageMs, setAgeMs] = useState(() => Date.now() - receivedAt.getTime());
  useEffect(() => {
    const id = setInterval(() => setAgeMs(Date.now() - receivedAt.getTime()), 10_000);
    return () => clearInterval(id);
  }, [receivedAt]);
  return ageMs;
}

function getAgingClasses(ageMs: number): string {
  const minutes = ageMs / 60_000;
  if (minutes < 10) {
    return "border-emerald-500 bg-gray-900";
  }
  if (minutes < 15) {
    return "border-amber-400 bg-gray-900 animate-pulse";
  }
  return "border-red-500 bg-red-950/30 animate-bounce";
}

/**
 * KDS ticket card — always dark, shows items with bump buttons.
 * Aging colors: green (<10min), amber+pulse (10-15min), red+bounce (15min+).
 * Auto-removes from board 60s after every item reaches a terminal (READY) state —
 * extended from the old ticket-level check to fully-resolved-item-level (KDS-03).
 */
export function KdsTicketCard({ ticket, branchId, canUpdate }: KdsTicketCardProps) {
  const ageMs = useTicketAge(ticket.receivedAt);
  const agingClasses = getAgingClasses(ageMs);
  const bumpItem = useBumpItem(branchId);

  const [visible, setVisible] = useState(true);

  // Fully-resolved-item-level (not just ticket-level): a ticket leaves the board
  // 60s after ALL its items reach READY (the only kitchen-owned terminal state in
  // the 5-value KdsItemStatus — SERVED/CANCELLED are pos-service-owned and never
  // appear here). Auto-remove is skipped for an empty item list (nothing to resolve).
  const allItemsResolved =
    ticket.items.length > 0 && ticket.items.every((item) => item.status === "READY");

  useEffect(() => {
    if (allItemsResolved) {
      const timer = setTimeout(() => setVisible(false), 60_000);
      return () => clearTimeout(timer);
    }
  }, [allItemsResolved]);

  if (!visible) return null;

  return (
    // animate-fade-in applied unconditionally: React's keyed reconciliation only
    // creates a new DOM node (and thus replays the mount-time CSS animation) for a
    // genuinely new ticket.id — an existing, re-rendered card reuses its DOM node
    // and the animation does not replay. This is KDS-03's "new tickets fade in
    // (200ms)" requirement with no extra new-ticket-tracking state needed.
    <div
      className={`rounded-xl border-2 p-4 ${agingClasses} transition-all duration-500 animate-fade-in`}
      data-testid="kds-ticket-card"
    >
      {/* Header — tap to open the full ticket detail (KDS-03) */}
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between mb-3 text-left"
            aria-label={`Open ticket detail for ${ticket.orderNo ?? ticket.id.slice(0, 8)}`}
          >
            <div>
              <span className="text-gray-400 text-xs uppercase tracking-widest">
                {ticket.orderNo ?? ticket.id.slice(0, 8)}
              </span>
              {ticket.priority && (
                <span className="ml-2 text-xs bg-red-600 text-white px-1.5 py-0.5 rounded font-bold">
                  PRIORITY
                </span>
              )}
            </div>
            <span className="text-gray-500 text-xs">{formatAge(ageMs)}</span>
          </button>
        </DialogTrigger>
        {/* Board stays always-dark inside the detail too — force dark tokens since
            the Dialog portals to document.body, outside the board's .dark scope. */}
        <DialogContent className="dark max-h-[85vh] overflow-y-auto border border-gray-800 bg-gray-950 text-gray-100 sm:max-w-lg">
          <DialogTitle className="sr-only">
            Ticket {ticket.orderNo ?? ticket.id.slice(0, 8)} detail
          </DialogTitle>
          <KdsTicketDetail ticketId={ticket.id} branchId={branchId} />
        </DialogContent>
      </Dialog>

      {/* Items */}
      <div className="flex flex-col gap-2">
        {ticket.items.map((item) => (
          <TicketItemRow
            key={item.id}
            item={item}
            ticketId={ticket.id}
            canUpdate={canUpdate}
            onBump={() => bumpItem.mutate({ ticketId: ticket.id, itemId: item.id })}
          />
        ))}
      </div>
    </div>
  );
}

interface TicketItemRowProps {
  item: KdsTicketItem;
  ticketId: string;
  canUpdate: boolean;
  onBump: () => void;
}

// StatusBadge's LineItemStatusVariant (7-value, pos-service OrderItemStatus-derived)
// doesn't include kitchen-service's local "COOKING" legacy value — normalize it to
// PREPARING (its treated-as-equivalent value, see kds.model.ts comment) before
// rendering. This is the single seam replacing the old 3-value statusColors dict.
function toLineItemStatusVariant(status: KdsItemStatus): LineItemStatusVariant {
  return status === "COOKING" ? "PREPARING" : status;
}

function TicketItemRow({ item, canUpdate, onBump }: TicketItemRowProps) {
  // Kitchen-actionable transitions only: START (PENDING->COOKING) and DONE
  // (COOKING/PREPARING->READY). ACCEPTED is automatic on render (no button); READY,
  // and any POS-side-only statuses, get no button on the KDS (UI-SPEC §4/§8).
  const bumpLabel =
    item.status === "PENDING"
      ? "START"
      : item.status === "COOKING" || item.status === "PREPARING"
        ? "DONE"
        : null;

  const bumpBtnClass =
    item.status === "PENDING"
      ? "bg-blue-600 hover:bg-blue-500 text-white"
      : "bg-emerald-600 hover:bg-emerald-500 text-white";

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <StatusBadge status={toLineItemStatusVariant(item.status)} />
          <RevisionBadge revisionNo={item.revisionNo} />
        </div>
        {/* text-2xl name stays un-recolored per status — too noisy at 2m readability;
            the status badge above is the sole per-item pipeline-stage channel. */}
        <div className="text-2xl font-bold text-white truncate">
          {item.qty > 1 && <span className="text-gray-300 mr-1">×{item.qty}</span>}
          {item.name}
        </div>
        {item.modifiers.length > 0 && (
          <div className="text-xs text-gray-500 mt-0.5">
            {item.modifiers.join(" · ")}
          </div>
        )}
        {item.notes && (
          <div className="text-xs text-amber-400 mt-0.5 italic">{item.notes}</div>
        )}
      </div>

      {canUpdate && bumpLabel && (
        <button
          onClick={onBump}
          className={`shrink-0 text-sm font-bold px-3 py-1.5 rounded-lg ${bumpBtnClass} transition-colors`}
          data-testid={`bump-btn-${item.id}`}
        >
          {bumpLabel}
        </button>
      )}
    </div>
  );
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m";
  return `${minutes}m`;
}

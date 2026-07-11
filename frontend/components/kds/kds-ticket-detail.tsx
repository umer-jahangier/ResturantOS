"use client";

import { MessageSquare } from "lucide-react";
import { useKdsTicketDetail } from "@/lib/hooks/kds/use-kds-tickets";
import { StatusBadge, type LineItemStatusVariant } from "@/components/ui/status-badge";
import { RevisionBadge } from "@/components/pos/revision-chip";
import type { KdsItemStatus, KdsTicketItem } from "@/lib/models/kds.model";

interface KdsTicketDetailProps {
  ticketId: string;
  branchId: string;
}

// StatusBadge's LineItemStatusVariant (7-value, pos-service OrderItemStatus-derived)
// doesn't include kitchen-service's local "COOKING" legacy value — normalize it to
// PREPARING (its treated-as-equivalent value, see kds.model.ts) before rendering.
function toLineItemStatusVariant(status: KdsItemStatus): LineItemStatusVariant {
  return status === "COOKING" ? "PREPARING" : status;
}

interface RevisionGroup {
  revisionNo: number;
  firedAt: string | null;
  items: KdsTicketItem[];
}

/** Groups ticket items by revisionNo (ascending), each with a representative firedAt. */
function groupByRevision(items: KdsTicketItem[]): RevisionGroup[] {
  const byRevision = new Map<number, KdsTicketItem[]>();
  for (const item of items) {
    const list = byRevision.get(item.revisionNo) ?? [];
    list.push(item);
    byRevision.set(item.revisionNo, list);
  }
  return Array.from(byRevision.entries())
    .sort(([a], [b]) => a - b)
    .map(([revisionNo, revItems]) => ({
      revisionNo,
      firedAt: revItems.find((i) => i.firedAt)?.firedAt ?? null,
      items: revItems,
    }));
}

function formatRevisionTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * KDS ticket detail (KDS-03) — tap-to-open modal body showing the full order:
 * revisions grouped by "Rev {n} · {time}", each item with its per-item status badge
 * and notes, plus the order-level "Kitchen Notes" callout (UI-SPEC §6) at the top.
 * Board stays always-dark inside the detail too — no theme-dependent classes here.
 */
export function KdsTicketDetail({ ticketId, branchId }: KdsTicketDetailProps) {
  const { data: ticket, isLoading } = useKdsTicketDetail(branchId, ticketId);

  if (isLoading || !ticket) {
    return <div className="p-4 text-sm text-gray-400">Loading ticket…</div>;
  }

  const revisions = groupByRevision(ticket.items);

  return (
    <div className="flex flex-col gap-4 text-gray-100" data-testid="kds-ticket-detail">
      <div>
        <h2 className="text-lg font-semibold text-white">
          {ticket.orderNo ?? ticket.id.slice(0, 8)}
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest">{ticket.stationCode}</p>
      </div>

      {ticket.orderNotes && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-amber-200">
          <MessageSquare className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
              Kitchen Notes
            </p>
            <p>{ticket.orderNotes}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {revisions.map((rev) => (
          <div key={rev.revisionNo}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Rev {rev.revisionNo} · {formatRevisionTime(rev.firedAt)}
            </h3>
            <div className="flex flex-col gap-2">
              {rev.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg bg-gray-900 p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={toLineItemStatusVariant(item.status)} />
                      <RevisionBadge revisionNo={item.revisionNo} />
                    </div>
                    <div className="text-base font-semibold text-white truncate">
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
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

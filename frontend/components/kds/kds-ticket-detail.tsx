"use client";

import { MessageSquare } from "lucide-react";
import { useKdsTicketDetail, useUpdateItemStatus } from "@/lib/hooks/kds/use-kds-tickets";
import { StatusBadge, type LineItemStatusVariant } from "@/components/ui/status-badge";
import { RevisionBadge } from "@/components/pos/revision-chip";
import {
  getNextItemStatus,
  mapItemStatusToColumn,
  KDS_COLUMN_LABELS,
} from "@/components/kds/kds-item-column";
import { T_BODY, T_H2, T_KDS, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import type { KdsItemStatus, KdsTicketItem } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

interface KdsTicketDetailProps {
  ticketId: string;
  branchId: string;
  /** Renders a per-item "Move to {next column}" transition control when true
   * (kds-station-detail.tsx, KDS-04/D-12) — omitted entirely for read-only
   * viewers (server still authoritatively gates the endpoint, T-07.3-29). */
  canUpdate?: boolean;
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
export function KdsTicketDetail({ ticketId, branchId, canUpdate = false }: KdsTicketDetailProps) {
  const detailQuery = useKdsTicketDetail(branchId, ticketId);
  const ticket = detailQuery.data;
  const updateItemStatus = useUpdateItemStatus(branchId);

  // GA-001 again: `isLoading || !ticket` folded a FAILED fetch into "Loading ticket…"
  // forever — a spinner is just a slower lie than an empty state. Error first, always.
  if (detailQuery.isError) {
    return (
      <QueryErrorNotice
        what="this ticket"
        error={detailQuery.error}
        isRetrying={detailQuery.isFetching}
        onRetry={() => detailQuery.refetch()}
      />
    );
  }

  if (detailQuery.isPending || !ticket) {
    return <div className={cn("p-4 text-kds-muted", T_BODY)}>Loading ticket…</div>;
  }

  const revisions = groupByRevision(ticket.items);

  return (
    <div className="flex flex-col gap-4 text-kds-text" data-testid="kds-ticket-detail">
      <div>
        <h2 className={cn("font-bold text-kds-text", T_KDS)}>
          {ticket.orderNo ?? ticket.id.slice(0, 8)}
        </h2>
        <p className={cn("uppercase tracking-widest text-kds-muted", T_LABEL)}>
          {ticket.stationCode}
        </p>
      </div>

      {ticket.orderNotes && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border-l-4 border-kds-warn bg-black/30 p-3 text-kds-text",
            T_BODY,
          )}
        >
          <MessageSquare className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className={cn("font-bold uppercase tracking-wide text-kds-warn", T_LABEL)}>
              Kitchen Notes
            </p>
            <p>{ticket.orderNotes}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {revisions.map((rev) => (
          <div key={rev.revisionNo}>
            <h3 className={cn("mb-2 font-bold uppercase tracking-wide text-kds-muted", T_LABEL)}>
              Rev {rev.revisionNo} · {formatRevisionTime(rev.firedAt)}
            </h3>
            <div className="flex flex-col gap-2">
              {rev.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-kds-card p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={toLineItemStatusVariant(item.status)} />
                      <RevisionBadge revisionNo={item.revisionNo} />
                    </div>
                    <div className={cn("truncate font-semibold text-kds-text", T_KDS)}>
                      {item.qty > 1 && <span className="mr-1 text-kds-muted">×{item.qty}</span>}
                      {item.name}
                    </div>
                    {item.modifiers.length > 0 && (
                      <div className={cn("mt-0.5 font-bold text-kds-warn", T_BODY)}>
                        {item.modifiers.join(" · ")}
                      </div>
                    )}
                    {item.notes && (
                      <div
                        className={cn(
                          "mt-0.5 rounded border-l-2 border-kds-warn bg-black/30 px-2 py-1 font-medium text-kds-text",
                          T_BODY,
                        )}
                      >
                        ▸ {item.notes}
                      </div>
                    )}
                  </div>
                  {canUpdate &&
                    (() => {
                      const nextStatus = getNextItemStatus(item.status);
                      if (!nextStatus) return null;
                      const nextColumn = mapItemStatusToColumn(nextStatus);
                      return (
                        <button
                          type="button"
                          data-testid={`detail-move-${item.id}`}
                          onClick={() =>
                            updateItemStatus.mutate({
                              ticketId,
                              itemId: item.id,
                              status: nextStatus,
                            })
                          }
                          className={cn(
                            "shrink-0 rounded-lg bg-primary-700 px-3 py-1.5 font-bold text-white transition-colors hover:bg-primary-800",
                            T_SMALL,
                          )}
                        >
                          {nextColumn ? `Move to ${KDS_COLUMN_LABELS[nextColumn]}` : "Advance"}
                        </button>
                      );
                    })()}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

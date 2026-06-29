"use client";

import { useEffect, useState } from "react";
import { useBumpItem } from "@/lib/hooks/kds/use-kds-tickets";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

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
 * Auto-removes from board 60s after reaching READY status.
 */
export function KdsTicketCard({ ticket, branchId, canUpdate }: KdsTicketCardProps) {
  const ageMs = useTicketAge(ticket.receivedAt);
  const agingClasses = getAgingClasses(ageMs);
  const bumpItem = useBumpItem(branchId);

  const [visible, setVisible] = useState(true);

  // Auto-remove READY tickets after 60 seconds
  useEffect(() => {
    if (ticket.status === "READY") {
      const timer = setTimeout(() => setVisible(false), 60_000);
      return () => clearTimeout(timer);
    }
  }, [ticket.status]);

  if (!visible) return null;

  return (
    <div
      className={`rounded-xl border-2 p-4 ${agingClasses} transition-all duration-500`}
      data-testid="kds-ticket-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
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
      </div>

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

function TicketItemRow({ item, canUpdate, onBump }: TicketItemRowProps) {
  const statusColors = {
    PENDING: "text-gray-400",
    COOKING: "text-amber-300",
    READY: "text-emerald-400",
  };

  const bumpLabel =
    item.status === "PENDING" ? "START" : item.status === "COOKING" ? "DONE" : null;

  const bumpBtnClass =
    item.status === "PENDING"
      ? "bg-blue-600 hover:bg-blue-500 text-white"
      : "bg-emerald-600 hover:bg-emerald-500 text-white";

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className={`text-2xl font-bold truncate ${statusColors[item.status]}`}>
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

      {canUpdate && bumpLabel && item.status !== "READY" && (
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

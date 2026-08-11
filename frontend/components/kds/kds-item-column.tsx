"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { useUpdateItemStatus } from "@/lib/hooks/kds/use-kds-tickets";
import type { KdsItemStatus, KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

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

/** The board-wide identity of one fragment — a ticket appears once PER COLUMN. */
export function fragmentKey(column: KdsColumnKey, ticketId: string): string {
  return `${column}:${ticketId}`;
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
  /** Station escalationThresholdSeconds (KDS-05/D-13) — drives each card's ageing. */
  escalationThresholdSeconds?: number;
  /**
   * Bump-bar focus model (§7.2). The board owns focus because ↑/↓ traverse ACROSS
   * columns; a column that owned its own focus could never hand off at its edge.
   */
  focusedKey?: string;
  /**
   * Fragments mid-bump. The card collapses to a 1px line and leaves after 400ms — the only
   * animation §7.2 permits on this screen, because it confirms an irreversible action. It is
   * `motion-safe:` so a cook who has asked their OS for reduced motion just sees it go.
   */
  collapsingKeys?: string[];
  /** Board-wide 1–9/0 position number for a fragment, or undefined past the tenth. */
  positionOf?: (key: string) => number | undefined;
  /** Lets the board hold a DOM ref per fragment for `scrollIntoView` on focus movement. */
  registerFragmentRef?: (key: string, el: HTMLDivElement | null) => void;
  /** Clicking or touching a card also moves focus — pointer and bump bar stay in sync. */
  onFocusFragment?: (key: string) => void;
}

/**
 * One New/Started/Preparing/Ready board column (KDS-04/D-12), rebuilt on the phase-20
 * `[data-surface="kds"]` tokens.
 *
 * Every `bg-gray-800` / `border-gray-700` / `bg-blue-600` literal is gone. The move button
 * in particular was `bg-blue-600` — a colour from no ramp in this system, on the one
 * control a cook presses hundreds of times a shift. It is now `--primary-700`, which
 * UI-SPEC §3.8 measures at 5.46:1 for white text; `--primary-500`/`600` were measured and
 * FAIL, which is exactly why the token, not the eye, picks the stop.
 */
export function KdsItemColumn({
  column,
  tickets,
  branchId,
  canUpdate,
  escalationThresholdSeconds,
  focusedKey,
  collapsingKeys,
  positionOf,
  registerFragmentRef,
  onFocusFragment,
}: KdsItemColumnProps) {
  const router = useRouter();
  const updateItemStatus = useUpdateItemStatus(branchId);
  const fragments = useMemo(() => groupTicketsByColumn(tickets, column), [tickets, column]);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={`kds-column-${column}`}>
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-kds-card px-3 py-2">
        <h3
          className={cn("font-bold uppercase tracking-wider text-kds-text", T_SMALL)}
          id={`kds-column-heading-${column}`}
        >
          {KDS_COLUMN_LABELS[column]}
        </h3>
        <span
          className={cn("font-bold tabular-nums text-kds-muted", T_SMALL)}
          data-testid={`kds-column-count-${column}`}
        >
          {fragments.length}
        </span>
      </div>

      <ul
        className="flex flex-col gap-2"
        aria-labelledby={`kds-column-heading-${column}`}
        data-testid={`kds-column-list-${column}`}
      >
        {fragments.length === 0 ? (
          <li className={cn("py-6 text-center text-kds-muted", T_LABEL)}>Nothing here</li>
        ) : (
          fragments.map(({ ticket, items }) => {
            const key = fragmentKey(column, ticket.id);
            const isFocused = focusedKey === key;
            const isCollapsing = collapsingKeys?.includes(key) ?? false;
            return (
              <li key={ticket.id}>
                <div
                  ref={(el) => registerFragmentRef?.(key, el)}
                  data-testid={`kds-fragment-${column}-${ticket.id}`}
                  data-fragment-key={key}
                  data-collapsing={isCollapsing ? "true" : undefined}
                  className={cn(
                    "animate-fade-in",
                    isCollapsing &&
                      "pointer-events-none motion-safe:h-px motion-safe:overflow-hidden motion-safe:opacity-0 motion-safe:transition-all motion-safe:duration-400 motion-reduce:hidden",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onFocusFragment?.(key);
                      router.push(`/app/kitchen/${ticket.stationCode}/orders/${ticket.id}`);
                    }}
                    className="w-full text-left"
                    aria-label={`Open ticket detail for ${ticket.orderNo ?? ticket.id.slice(0, 8)}`}
                  >
                    <KdsTicketCard
                      ticket={ticket}
                      items={items}
                      positionNumber={positionOf?.(key)}
                      isFocused={isFocused}
                      escalationThresholdSeconds={escalationThresholdSeconds}
                    />
                  </button>
                  {canUpdate && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {items.map((item) => {
                        const nextStatus = getNextItemStatus(item.status);
                        if (!nextStatus) return null;
                        const nextColumn = mapItemStatusToColumn(nextStatus) ?? column;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-testid={`column-move-${item.id}`}
                            onClick={() => {
                              onFocusFragment?.(key);
                              updateItemStatus.mutate({
                                ticketId: ticket.id,
                                itemId: item.id,
                                status: nextStatus,
                              });
                            }}
                            className={cn(
                              "rounded-md bg-primary-700 px-2 py-1.5 font-bold text-white transition-colors hover:bg-primary-800",
                              T_SMALL,
                            )}
                          >
                            {item.name} → {KDS_COLUMN_LABELS[nextColumn]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

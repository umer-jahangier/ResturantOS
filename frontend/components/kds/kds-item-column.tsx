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

/**
 * NEW · STARTED · PREPARING · READY.
 *
 * <h3>Why this is NOT UI-SPEC §9.3's "NEW · PREPARING · READY · COMPLETED", and what it would take</h3>
 *
 * Recorded here rather than only in a report, because the next reader will otherwise compare the
 * two lists, assume drift, and "fix" it.
 *
 * These four are not labels over a layout. Each one IS a kitchen-service item status, and the set
 * is fixed by `validateTransition` on the server: `PENDING → ACCEPTED → PREPARING/COOKING →
 * READY`. Adopting the spec's four means two separate product changes, neither of them a UI one:
 *
 *   1. **Merging ACCEPTED into PREPARING** deletes a bump step. A cook currently bumps a line
 *      three times and the card MOVES all three times, which is the entire feedback loop of a
 *      bump bar. Merged, the first bump would leave the card exactly where it was — the cook
 *      would read that as "the key did nothing" and press it again, and the second press would
 *      send the dish to READY uncooked. The API would still accept and record the ACCEPTED
 *      transition, so the board would also be showing a state the server does not agree with.
 *   2. **A COMPLETED column has no data behind it.** `useKdsTickets` reads the server's
 *      `PENDING,COOKING,READY` filter, and `isBoardTicket` drops SERVED / CANCELLED / CLEARED on
 *      purpose — a finished check is not the kitchen's work any more. A COMPLETED column would
 *      therefore be permanently empty while occupying a quarter of a board read at two metres,
 *      which is worse than not having it. Completed work already has a surface:
 *      `/app/kitchen/[stationCode]/cleared`.
 *
 * 38-05's own "Out of scope" section says "ticket routing logic", and the phase's binding rule is
 * that API contracts are preserved exactly. So the columns stay as the statuses are, and the
 * spec's row is a request for a kitchen-service change — a terminal per-item state, and a
 * decision about whether ACCEPTED earns its own stage — not something a screen plan may invent.
 */
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
  /**
   * How many fragments this column holds in TOTAL, across every page — not just the ones
   * `tickets` carries for the current page. The header count reads from this, so a cook
   * looking at "Started 5" while two of them are on the next page still knows five things
   * are in progress. Defaults to the rendered count when the caller does not page.
   */
  totalCount?: number;
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
  totalCount,
  positionOf,
  registerFragmentRef,
  onFocusFragment,
}: KdsItemColumnProps) {
  const router = useRouter();
  const updateItemStatus = useUpdateItemStatus(branchId);
  const fragments = useMemo(() => groupTicketsByColumn(tickets, column), [tickets, column]);
  const total = totalCount ?? fragments.length;
  const overflow = Math.max(0, total - fragments.length);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={`kds-column-${column}`}>
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-kds-card px-3 py-2">
        <h3
          className={cn("font-bold uppercase tracking-wider text-kds-text", T_SMALL)}
          id={`kds-column-heading-${column}`}
        >
          {KDS_COLUMN_LABELS[column]}
        </h3>
        {/*
          TICKETS in this column, not items — the same figure the station picker's per-stage
          split shows, from the same helper. The number stays bare on screen (four repetitions
          of the word "tickets" is noise on a display read at two metres, and the board header
          two lines up already names the unit) but it is spelled out for assistive tech, which
          otherwise announces "New, 76" and leaves the unit to be guessed.
        */}
        <span
          className={cn("font-bold tabular-nums text-kds-muted", T_SMALL)}
          data-testid={`kds-column-count-${column}`}
          aria-label={`${total} ${total === 1 ? "ticket" : "tickets"}`}
        >
          {total}
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
            const position = positionOf?.(key);
            return (
              <li key={ticket.id}>
                <div
                  ref={(el) => registerFragmentRef?.(key, el)}
                  data-testid={`kds-fragment-${column}-${ticket.id}`}
                  data-fragment-key={key}
                  // The jump key that reaches this card, on the wrapper as well as printed on
                  // the face — so "is every visible card reachable?" is one DOM query, and a
                  // regression that silently un-numbers a card cannot hide behind a screenshot.
                  data-position={position === undefined ? "" : String(position)}
                  data-collapsing={isCollapsing ? "true" : undefined}
                  className={cn(
                    /*
                     * NO entrance animation here (D-34-02). `animate-fade-in` used to sit on
                     * this element and it violated the operational-zone contract outright:
                     * every ticket fragment ran a 0.2s fadeIn on mount, so arriving on the
                     * board played one animation per open ticket at once — the same defect
                     * 34-03 removed from the board root, still present one level down.
                     *
                     * It survived because the three assertions that were supposed to catch it
                     * never reached this screen: they navigated with
                     * `a[href^="/app/kitchen/"]`, the station tiles are BUTTONS, so all three
                     * ran against the station picker instead and passed on a screen with no
                     * tickets on it. Found 2026-08-12 by adding a board anchor.
                     *
                     * The collapse transition below STAYS, and 38-05 was asked to say why rather
                     * than to keep or drop it quietly. The reasoning, in full:
                     *
                     * **It is not what the gate is for.** "0 running animations on the board"
                     * exists to stop AMBIENT motion — an entrance fade per ticket on arrival, an
                     * attention loop on a late card, a page transition the shell applies to every
                     * route. All of those run without anyone asking, on a screen read at two
                     * metres, and they cost a cook their place on the board. This runs only in
                     * the 400ms after the cook themself pressed `F`, and it is the only signal
                     * that an OPTIMISTIC bump landed — the mutation is still in flight, the card
                     * is still in the DOM, and without the collapse a successful bump and a dead
                     * key are the same picture. UI-SPEC §7.2 names it as the one permitted
                     * animation for exactly that reason.
                     *
                     * **So it is a sanctioned exception, not a gate hole** — but only if the gate
                     * can tell the two apart without a stopwatch, and only if the exception
                     * cannot quietly grow. Both are now true:
                     *
                     *   - the element carries `data-collapsing="true"` for the whole window, so a
                     *     gate that samples mid-bump excludes it by SELECTOR rather than by
                     *     hoping to sample at rest. At rest there is no such element and the
                     *     count is 0, unconditionally.
                     *
                     *     TRUE AS OF 38-13, and it was not true when it was written. The
                     *     attribute was here; no gate anywhere referenced it. `grep -rn
                     *     data-collapsing __tests__ e2e` returned nothing — a fence that
                     *     existed only in this paragraph. It is real now:
                     *     `reduced-motion.spec.ts` filters on it and
                     *     `kds-operational-stillness.test.ts` fences the class list.
                     *
                     *     38-13 also found the gate could never have gone red for this in the
                     *     first place: it read `getComputedStyle(el).animationName`, and a
                     *     TRANSITION has no animation-name — only `@keyframes` do. So it saw
                     *     no transition anywhere on this board, sanctioned or not. That is a
                     *     bigger hole than the one this exception was suspected of being, and
                     *     it is why the gate now reads `getAnimations()`.
                     *   - `transition-all` became `transition-opacity`. `all` was an open door:
                     *     it transitions every animatable property, so the day someone adds a
                     *     `transform` or a `filter` to a collapsing card the exception silently
                     *     widens into precisely the compositing motion D-38-04 forbids, and the
                     *     gate would be arguing about a property nobody chose to animate. It
                     *     also over-promised — `height: auto → 1px` is not interpolable, so the
                     *     geometry never transitioned in the first place; the card has always
                     *     snapped out of the way and faded. Naming `opacity` is what actually
                     *     happens, with the door shut. Same 400ms, same rendered result.
                     *
                     * Still `motion-safe:`, so a cook who has asked their OS for reduced motion
                     * gets `hidden` and no transition at all.
                     */
                    isCollapsing &&
                      "pointer-events-none motion-safe:h-px motion-safe:overflow-hidden motion-safe:opacity-0 motion-safe:transition-opacity motion-safe:duration-400 motion-reduce:hidden",
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
                      positionNumber={position}
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
                              // Focus follows the item to where it is GOING, not where it
                              // was. The board pages to whatever holds the focused fragment,
                              // so this is what puts the cook's own bump back in front of
                              // them when the destination column is more than a page deep.
                              onFocusFragment?.(fragmentKey(nextColumn, ticket.id));
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
        {/*
          The depth of the queue that is not on this page. Without it, a column showing three
          of its twelve is a column that LOOKS three deep, and the cook's only clue that nine
          more exist would be a page indicator in the far corner of the header.

          Deliberately not "PgDn": paging is fair across columns, so a column's remaining
          fragments can sit on a page either side of this one. Naming a direction would be
          right about half the time, which on this screen is worse than naming none.
        */}
        {overflow > 0 && (
          <li
            data-testid={`kds-column-more-${column}`}
            className={cn("py-2 text-center font-semibold text-kds-muted", T_LABEL)}
          >
            +{overflow} on other pages
          </li>
        )}
      </ul>
    </div>
  );
}

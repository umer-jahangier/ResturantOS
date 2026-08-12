import {
  KDS_COLUMN_ORDER,
  mapItemStatusToColumn,
  type KdsColumnKey,
} from "@/components/kds/kds-item-column";
import type { KdsTicket } from "@/lib/models/kds.model";

/**
 * The ONE derivation behind every count a cook reads on a KDS surface.
 *
 * <h3>Why this file exists</h3>
 *
 * The station picker and the station board each counted "tickets" with their own arithmetic,
 * and the two arithmetics answered different questions under the same word. Measured live on
 * 2026-08-12 as `kitchen@terrace.local`, branch F-7, twice twenty minutes apart:
 *
 * <pre>
 *   station    picker tile   board header   picker split      board split
 *   DEFAULT    120 tickets   111 tickets    97 NEW / 20 STA   76 NEW / 18 STA
 *   PANTRY1     18 tickets    12 tickets    12 NEW            12 NEW
 *   GRILL        6 tickets     5 tickets     5 NEW             5 NEW
 * </pre>
 *
 * Neither number was right, and they were wrong in opposite directions:
 *
 * <ul>
 *   <li><b>The picker counted tickets the board does not draw.</b> Its queue depth was
 *   "every ticket whose STATUS is not SERVED/CANCELLED". A ticket whose every LINE has since
 *   been served on the POS keeps ticket-status READY forever, maps to no board column, and
 *   renders nowhere — yet it was counted. Cross-read over HTTP on the cook's own bearer:
 *   DEFAULT carried 12 such tickets (16 SERVED lines), PANTRY1 6, GRILL 1. That is exactly the
 *   120→108, 18→12, 6→5 gap.</li>
 *
 *   <li><b>The board counted cards and called them tickets.</b> Its header read
 *   `allFragments.length` — the ticket×column FRAGMENT list. One check with a started starter
 *   and an unstarted main is one ticket and two cards, so the header inflated by one per split
 *   check, and — this is the part that made it useless — <b>bumping a single item of a
 *   multi-item ticket changed the total</b>, because it split one fragment into two.</li>
 * </ul>
 *
 * Both surfaces now read from here, so "tickets" means the same thing on both by construction
 * and not by two functions agreeing to.
 *
 * <h3>What the words mean</h3>
 *
 * <ul>
 *   <li><b>ticket</b> — one check at this station that the board actually draws at least one
 *   card for. Never a card; never a check with nothing left to cook.</li>
 *   <li><b>item</b> — one live dish line. A ticket with a starter and a main is 1 ticket,
 *   2 items.</li>
 *   <li><b>columnTickets</b> — tickets holding at least one item in that column, i.e. the
 *   CARDS the board draws in it. This is what the board's column headers count, so the picker
 *   counts the same thing rather than counting items and printing them side by side with the
 *   board's cards.</li>
 * </ul>
 *
 * A ticket with items in two columns counts once in `ticketCount` and once in EACH of those
 * columns, so the column figures deliberately sum to more than the total. Both surfaces label
 * the unit on screen, which is the other half of this fix.
 */
export interface KdsStationCounts {
  /** Checks this station's board draws at least one card for. */
  ticketCount: number;
  /** Live dish lines across those checks. */
  itemCount: number;
  /** Age (ms) of the oldest such ticket, or null when the station is clear. */
  oldestAgeMs: number | null;
  /** Cards per board column — tickets holding ≥1 item in that column. */
  columnTickets: Record<KdsColumnKey, number>;
  /** Live items per board column. */
  columnItems: Record<KdsColumnKey, number>;
}

export function emptyKdsCounts(): KdsStationCounts {
  return {
    ticketCount: 0,
    itemCount: 0,
    oldestAgeMs: null,
    columnTickets: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
    columnItems: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
  };
}

/**
 * Is this ticket ON the board?
 *
 * Two conditions, and the second one is the one that was missing. A terminal ticket status
 * (SERVED/CANCELLED) drops it, and so does having no line left in any board column — every
 * item CANCELLED by the POS, or every item already SERVED. `mapItemStatusToColumn` returning
 * `null` is precisely "the board has no place to draw this", so asking it is the same question
 * the renderer asks, rather than a second opinion about it.
 */
export function isBoardTicket(ticket: KdsTicket): boolean {
  if (ticket.status === "SERVED" || ticket.status === "CANCELLED") return false;
  return ticket.items.some((item) => mapItemStatusToColumn(item.status) !== null);
}

/** Counts for one station's ticket list. `now` comes from the shared KDS clock, never `Date.now()`. */
export function computeKdsCounts(tickets: readonly KdsTicket[], now: number): KdsStationCounts {
  const counts = emptyKdsCounts();
  for (const ticket of tickets) {
    if (!isBoardTicket(ticket)) continue;
    counts.ticketCount += 1;
    const columnsSeen = new Set<KdsColumnKey>();
    for (const item of ticket.items) {
      const column = mapItemStatusToColumn(item.status);
      if (!column) continue;
      counts.itemCount += 1;
      counts.columnItems[column] += 1;
      columnsSeen.add(column);
    }
    for (const column of columnsSeen) counts.columnTickets[column] += 1;
    const ageMs = now - ticket.receivedAt.getTime();
    counts.oldestAgeMs = counts.oldestAgeMs === null ? ageMs : Math.max(counts.oldestAgeMs, ageMs);
  }
  return counts;
}

/** The same derivation, grouped by `stationCode` — what the picker needs from a branch-wide read. */
export function computeKdsCountsByStation(
  tickets: readonly KdsTicket[],
  now: number,
): Map<string, KdsStationCounts> {
  const byStation = new Map<string, KdsTicket[]>();
  for (const ticket of tickets) {
    const list = byStation.get(ticket.stationCode);
    if (list) list.push(ticket);
    else byStation.set(ticket.stationCode, [ticket]);
  }
  const out = new Map<string, KdsStationCounts>();
  for (const [code, list] of byStation) out.set(code, computeKdsCounts(list, now));
  return out;
}

/** `"1 ticket"` / `"7 tickets"` — the unit is never left for the reader to infer. */
export function ticketLabel(n: number): string {
  return `${n} ${n === 1 ? "ticket" : "tickets"}`;
}

/** `"1 item"` / `"9 items"`. */
export function itemLabel(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

export { KDS_COLUMN_ORDER };
export type { KdsColumnKey };

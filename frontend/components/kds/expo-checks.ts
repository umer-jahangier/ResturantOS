import { getAgingState, type KdsAgingState } from "@/components/kds/kds-aging";
import { isBoardTicket } from "@/components/kds/kds-counts";
import { mapItemStatusToColumn } from "@/components/kds/kds-item-column";
import type { KdsStation, KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

/**
 * The pass, as a derivation.
 *
 * <h3>The thing the product could not say</h3>
 *
 * A check is one thing to a guest and N things to the kitchen. `TicketRoutingService` splits
 * an order into <b>one ticket per (order, station)</b>, and every KDS surface built on top of
 * that split shows one station at a time: the boards are station-isolated by route, and the
 * picker aggregates per station. So the product could say "PANTRY1 has 40 tickets" and
 * "DEFAULT has 63", and could not say <b>"table H1 is half ready"</b> — which is the only
 * sentence an expeditor needs.
 *
 * Measured in the full-shift walkthrough (§3 #15): one check split to two stations, one
 * station finished both its lines, the other never started, and nothing in the product told
 * anyone. By the time it was noticed the check was paid and closed.
 *
 * This module re-assembles the check. It is deliberately the ONLY place that does, and it is
 * deliberately built out of the SAME two predicates the boards are built out of:
 *
 * <ul>
 *   <li>{@link isBoardTicket} — is this ticket on a board at all? (`kds-counts.ts` exists
 *   because the picker and the board once answered that differently under the same word, and
 *   were 21 apart on the busiest board.)</li>
 *   <li>{@link mapItemStatusToColumn} — is this LINE live work? `null` means the board draws
 *   nothing for it: a line the POS already served, or cancelled.</li>
 * </ul>
 *
 * A third arithmetic here would recreate exactly the defect `kds-counts.ts` was written to
 * kill — the pass would say a station still owed a dish that the board had already stopped
 * drawing, and there would be no way to tell which screen was lying.
 *
 * <h3>The rule that decides everything</h3>
 *
 * <b>A check is ready when EVERY station's live lines are ready — never when ANY station's
 * are.</b> That single quantifier is the whole feature: an `any` here reproduces the
 * walkthrough's failure with a screen in front of it, which is worse than not shipping one,
 * because now somebody trusts it.
 */

/** Where a check (or one station's part of it) has got to. */
export type ExpoState = "waiting" | "cooking" | "ready";

/** What one station still owes on one check. */
export interface ExpoStationLine {
  stationCode: string;
  /** The station's real name from the registry; falls back to the code. */
  stationName: string;
  ticketId: string;
  /** Live lines only — served and cancelled lines are not work and are not shown. */
  items: KdsTicketItem[];
  itemCount: number;
  readyCount: number;
  outstandingCount: number;
  state: ExpoState;
  ageMs: number;
  /** Ageing measured against THIS station's own escalation threshold, never a global one. */
  agingState: KdsAgingState;
}

/** One check, whole, across every station cooking part of it. */
export interface ExpoCheck {
  orderId: string;
  orderNo: string | null;
  tableNumber: string | null;
  orderType: string | null;
  orderNotes: string | null;
  /** Earliest fire across the check's stations — when the guest's wait actually started. */
  receivedAt: Date;
  ageMs: number;
  /** The WORST station's ageing state: a check is late if any part of it is late. */
  agingState: KdsAgingState;
  stations: ExpoStationLine[];
  stationCount: number;
  /** Stations with at least one line not yet ready. Zero means the check can run. */
  stationsOwing: number;
  itemCount: number;
  readyCount: number;
  state: ExpoState;
}

const DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900;

/** A line the board draws — i.e. real outstanding or ready work, not a served/cancelled one. */
function isLiveItem(item: KdsTicketItem): boolean {
  return mapItemStatusToColumn(item.status) !== null;
}

function stationState(items: readonly KdsTicketItem[]): ExpoState {
  if (items.length === 0) return "ready";
  if (items.every((i) => mapItemStatusToColumn(i.status) === "READY")) return "ready";
  if (items.every((i) => mapItemStatusToColumn(i.status) === "NEW")) return "waiting";
  return "cooking";
}

/**
 * Every open check at the branch, assembled from its station tickets.
 *
 * @param tickets branch-wide active tickets (the station-less `/kds/tickets` read)
 * @param stations the branch's station registry — for real names and per-station thresholds
 * @param now the shared KDS clock tick, never `Date.now()` read during render
 */
export function computeExpoChecks(
  tickets: readonly KdsTicket[],
  stations: readonly KdsStation[],
  now: number,
): ExpoCheck[] {
  const registry = new Map(stations.map((s) => [s.code, s]));
  const byOrder = new Map<string, KdsTicket[]>();

  for (const ticket of tickets) {
    // Same gate the boards use. A ticket the board draws nothing for is not work the pass
    // may claim is outstanding.
    if (!isBoardTicket(ticket)) continue;
    const list = byOrder.get(ticket.orderId);
    if (list) list.push(ticket);
    else byOrder.set(ticket.orderId, [ticket]);
  }

  const checks: ExpoCheck[] = [];

  for (const [orderId, orderTickets] of byOrder) {
    const lines: ExpoStationLine[] = [];

    for (const ticket of orderTickets) {
      const items = ticket.items.filter(isLiveItem);
      const station = registry.get(ticket.stationCode);
      const threshold = station?.escalationThresholdSeconds || DEFAULT_ESCALATION_THRESHOLD_SECONDS;
      const ageMs = Math.max(0, now - ticket.receivedAt.getTime());
      const readyCount = items.filter((i) => mapItemStatusToColumn(i.status) === "READY").length;
      lines.push({
        stationCode: ticket.stationCode,
        stationName: station?.name ?? ticket.stationCode,
        ticketId: ticket.id,
        items,
        itemCount: items.length,
        readyCount,
        outstandingCount: items.length - readyCount,
        state: stationState(items),
        ageMs,
        agingState: getAgingState(ageMs, threshold),
      });
    }

    // Stable, name-independent order so a station's row never jumps as names load.
    lines.sort((a, b) => a.stationCode.localeCompare(b.stationCode));

    const stationsOwing = lines.filter((l) => l.state !== "ready").length;
    const itemCount = lines.reduce((n, l) => n + l.itemCount, 0);
    const readyCount = lines.reduce((n, l) => n + l.readyCount, 0);
    // EVERY, not SOME. See the module header.
    const state: ExpoState =
      stationsOwing === 0
        ? "ready"
        : lines.every((l) => l.state === "waiting")
          ? "waiting"
          : "cooking";

    const receivedAt = orderTickets.reduce(
      (earliest, t) => (t.receivedAt < earliest ? t.receivedAt : earliest),
      orderTickets[0]!.receivedAt,
    );
    const head = orderTickets[0]!;

    checks.push({
      orderId,
      orderNo: head.orderNo,
      // A late add can create a second ticket before the table number was known; take the
      // first station line that actually has one rather than whichever ticket sorted first.
      tableNumber: orderTickets.find((t) => t.tableNumber)?.tableNumber ?? null,
      orderType: orderTickets.find((t) => t.orderType)?.orderType ?? null,
      orderNotes: orderTickets.find((t) => t.orderNotes)?.orderNotes ?? null,
      receivedAt,
      ageMs: Math.max(0, now - receivedAt.getTime()),
      agingState: worstAging(lines),
      stations: lines,
      stationCount: lines.length,
      stationsOwing,
      itemCount,
      readyCount,
      state,
    });
  }

  return sortExpoChecks(checks);
}

const AGING_RANK: Record<KdsAgingState, number> = { fresh: 0, warn: 1, late: 2 };

function worstAging(lines: readonly ExpoStationLine[]): KdsAgingState {
  let worst: KdsAgingState = "fresh";
  for (const line of lines) {
    if (AGING_RANK[line.agingState] > AGING_RANK[worst]) worst = line.agingState;
  }
  return worst;
}

const STATE_RANK: Record<ExpoState, number> = { ready: 0, cooking: 1, waiting: 2 };

/**
 * Ready-to-run first, then oldest first, ties broken by orderId.
 *
 * A pass is not a queue of incoming work — it is a list of things somebody has to ACT on, and
 * the plates going cold under the lamp are the most urgent item on it. Everything after that
 * is ordered by how long the guest has been waiting. `orderId` breaks ties so the list never
 * reshuffles under a cook's hand between two clock ticks.
 */
export function sortExpoChecks(checks: readonly ExpoCheck[]): ExpoCheck[] {
  return [...checks].sort((a, b) => {
    const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byState !== 0) return byState;
    const byAge = b.ageMs - a.ageMs;
    if (byAge !== 0) return byAge;
    return a.orderId.localeCompare(b.orderId);
  });
}

/**
 * The headline a cook reads across the room.
 *
 * Names the station that is holding the table up whenever naming it fits — "waiting on
 * DEFAULT" is instantly actionable and "waiting on 1 of 2 stations" is a puzzle.
 */
export function expoHeadline(check: ExpoCheck): string {
  if (check.state === "ready") return "All ready — run it";
  const owing = check.stations.filter((l) => l.state !== "ready");
  if (owing.length === 1) return `Waiting on ${owing[0]!.stationCode}`;
  if (owing.length === 2) return `Waiting on ${owing[0]!.stationCode} and ${owing[1]!.stationCode}`;
  return `Waiting on ${owing.length} of ${check.stationCount} stations`;
}

/** "1 of 2 stations ready" — the unit is never left for the reader to infer. */
export function expoStationProgress(check: ExpoCheck): string {
  const ready = check.stationCount - check.stationsOwing;
  return `${ready} of ${check.stationCount} ${check.stationCount === 1 ? "station" : "stations"} ready`;
}

/** "2 of 3 items ready". */
export function expoItemProgress(check: ExpoCheck): string {
  return `${check.readyCount} of ${check.itemCount} ${check.itemCount === 1 ? "item" : "items"} ready`;
}

export const EXPO_STATION_STATE_LABELS: Record<ExpoState, string> = {
  waiting: "Not started",
  cooking: "Cooking",
  ready: "Ready",
};

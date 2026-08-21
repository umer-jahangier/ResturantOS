"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChefHat,
  Clock,
  ConciergeBell,
  Flame,
  Layers,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { cn } from "@/lib/utils";
import { useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import { KDS_COLUMN_LABELS, type KdsColumnKey } from "@/components/kds/kds-item-column";
import {
  computeKdsCountsByStation,
  emptyKdsCounts,
  itemLabel,
  ticketLabel,
  type KdsStationCounts,
} from "@/components/kds/kds-counts";
import { getAgingState } from "@/components/kds/kds-aging";
import { readElapsed } from "@/lib/format/elapsed";
import type { KdsStation } from "@/lib/models/kds.model";

interface StationPickerProps {
  branchId: string;
}

const DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900; // 15 min

/*
 * The counting used to live here, and it disagreed with the board's counting under the
 * same word. It said "120 tickets" on DEFAULT while the board said 111 and the truth was
 * 108, because it counted every ticket whose STATUS was not SERVED/CANCELLED — including
 * twelve whose every line had already been served on the POS and which the board therefore
 * draws nothing for. `kds-counts.ts` now owns the derivation for both surfaces; see its
 * header for the measurements.
 */

const COLUMN_ORDER: readonly KdsColumnKey[] = ["NEW", "STARTED", "PREPARING", "READY"];

/**
 * What the tile's "oldest" line says, and how loudly.
 *
 * <h3>The line this replaces was a lie told in the colour that matters</h3>
 *
 * This file grew its own unbounded `formatAge` (minutes → hours, forever) and printed the
 * result through a treatment that only ever asked `getAgingState`. Against a 15-minute
 * escalation threshold, EVERY ticket older than fifteen minutes is `late`, so a check fired
 * four days ago rendered `Oldest 113h 52m` in `--kds-late` — the same red, the same weight,
 * the same shape as a check that is genuinely three minutes past its target. The audit
 * photographed exactly that on both station cards.
 *
 * Two things are wrong with it and only one of them is the number. A cook cannot convert 113
 * hours into "the Friday before last" while plating; and because the stale ticket shouts in the
 * urgent colour, the urgent colour stops meaning urgent. A board that cries wolf twice a day is
 * a board whose alarms are ignored by the end of the week, which is the whole reason
 * `lib/format/elapsed.ts` returns `withinUrgencyWindow` as a VALUE rather than leaving each
 * surface to remember a threshold.
 *
 * <h3>Past the bound the reading changes on four channels, not one</h3>
 *
 * §4.2 / D-38-13: no state may be carried by hue alone. Crossing 24 h changes
 *
 *   1. the **text shape** — a running timer (`07:42`) becomes a date (`7 Aug`), which is a
 *      different KIND of answer and survives greyscale, CVD and a wall screen with the contrast
 *      wound down;
 *   2. the **word** — "Oldest" becomes "Oldest from", so the line reads as provenance rather
 *      than as a countdown;
 *   3. the **icon shape** — `Timer`/`AlertTriangle`/`Flame` become `CalendarClock`;
 *   4. the **hue** — last, and never on its own — drops to `--kds-muted`.
 *
 * Below the bound the icon still varies by SHAPE across fresh/warn/late rather than being one
 * `Timer` in three colours, which is the same four-channel discipline `kds-aging.ts` applies to
 * the ticket face. The thresholds themselves are still `getAgingState`'s — this function reads
 * them, it does not own them.
 */
interface OldestReading {
  /** The visible line, unit and all. */
  text: string;
  /** CHANNEL — shape. Never one glyph in three colours. */
  Icon: LucideIcon;
  /** CHANNEL — hue, applied last and never alone. */
  toneClass: string;
  /** Bold only while this is live work; a stale reading must not shout. */
  emphasise: boolean;
  /** What assistive tech hears; the compact form is a clock time when announced bare. */
  srLabel: string;
  /** `false` once past the 24 h bound — asserted by the e2e gate, hence on the DOM too. */
  withinUrgencyWindow: boolean;
}

function readOldest(
  oldestReceivedAtMs: number | null,
  now: number,
  thresholdSeconds: number,
): OldestReading | null {
  if (oldestReceivedAtMs === null) return null;
  const elapsed = readElapsed(oldestReceivedAtMs, now);

  // History, not work. The urgency treatment is WITHDRAWN here — not softened.
  if (!elapsed.withinUrgencyWindow) {
    return {
      text: `Oldest from ${elapsed.compact}`,
      Icon: CalendarClock,
      toneClass: "text-kds-muted",
      emphasise: false,
      srLabel: `Oldest ticket fired ${elapsed.srLabel} — older than a day, not live work`,
      withinUrgencyWindow: false,
    };
  }

  // The same three states the board uses, from the same fractions, so a tile that says
  // "late" and a board that says "on time" cannot be the same station.
  const state = getAgingState(elapsed.ageMs ?? 0, thresholdSeconds);
  return {
    text: `Oldest ${elapsed.compact}`,
    Icon: state === "late" ? Flame : state === "warn" ? AlertTriangle : Timer,
    toneClass:
      state === "late"
        ? "text-kds-late"
        : state === "warn"
          ? "text-kds-warn"
          : "text-kds-fresh",
    emphasise: state !== "fresh",
    srLabel:
      state === "late"
        ? `Oldest ticket ${elapsed.srLabel} — late`
        : state === "warn"
          ? `Oldest ticket ${elapsed.srLabel} — due`
          : `Oldest ticket ${elapsed.srLabel}`,
    withinUrgencyWindow: true,
  };
}

/**
 * KDS station picker + live overview (KDS-04/D-12, #6 station stats) — `kitchen/`
 * route. Each tile shows the station's live queue depth, item count, and oldest-ticket
 * age (amber/red as it approaches/exceeds the station's escalation threshold) instead of
 * a bare name. A single station still auto-navigates straight to its isolated board.
 */
export function StationPicker({ branchId }: StationPickerProps) {
  const router = useRouter();
  const stationsQuery = useKdsStations(branchId);
  const ticketsQuery = useKdsTickets(branchId);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);
  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const isLoading = stationsQuery.isPending;

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const singleStation = activeStations.length === 1 ? activeStations[0] : null;
  // `now` comes from the shared KDS clock (one 10s tick for every KDS surface) rather
  // than a `Date.now()` read during render — the latter is impure, and it made the
  // oldest-ticket age depend on whatever else happened to trigger a re-render.
  const now = useKdsClock();
  const stats = useMemo(() => computeKdsCountsByStation(tickets, now), [tickets, now]);

  useEffect(() => {
    if (singleStation) {
      router.replace(`/app/kitchen/${singleStation.code}`);
    }
  }, [singleStation, router]);

  // GA-001, on the kitchen's front door: a station list that failed to load must never
  // render as "no stations configured". Error is checked BEFORE empty, always.
  if (stationsQuery.isError || ticketsQuery.isError) {
    const failed = stationsQuery.isError ? stationsQuery : ticketsQuery;
    return (
      <div data-surface="kds" className="min-h-full bg-kds-surface p-6 text-kds-text">
        <QueryErrorNotice
          what="the kitchen stations"
          error={failed.error}
          isRetrying={stationsQuery.isFetching || ticketsQuery.isFetching}
          onRetry={() => {
            stationsQuery.refetch();
            ticketsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (isLoading || singleStation) {
    return (
      <div
        data-surface="kds"
        className={cn(
          "flex min-h-full items-center justify-center bg-kds-surface text-kds-muted",
          T_H1,
        )}
      >
        Loading stations…
      </div>
    );
  }

  if (activeStations.length === 0) {
    return (
      <div
        data-surface="kds"
        data-testid="kds-no-stations"
        className="flex min-h-full flex-col items-center justify-center gap-4 bg-kds-surface p-6 text-center"
      >
        {/*
          This sentence used to be a lie by omission. kds_stations was written only by the
          ticket-routing path, so a station an admin had genuinely created did not appear here
          until its first ticket landed — and this screen said "none configured" about a branch
          that had five. The station list is now synced from pos-service's registry before every
          read, so reaching this state means the branch really has no stations, and the one useful
          thing to say is where to make one.

          Built on the kds tokens rather than the shared <EmptyState>, whose title is
          `text-foreground` and whose icon disc is `bg-surface-2` — both follow the office
          manager's light/dark preference, while this surface is permanently dark (§3.7). Through
          EmptyState this text rendered near-black on a near-black board: present in the DOM,
          unreadable on the wall.
        */}
        <div
          aria-hidden="true"
          className="flex size-20 items-center justify-center rounded-full bg-kds-card"
        >
          <ChefHat className="size-9 text-kds-muted" aria-hidden="true" />
        </div>
        <div className="flex max-w-xl flex-col gap-1">
          <p data-testid="kds-no-stations-title" className={cn("font-bold text-kds-text", T_H1)}>
            No active stations configured
          </p>
          <p className={cn("text-kds-muted", T_SMALL)}>
            An administrator creates one under Menu → Stations. Once it exists it appears here
            straight away — it does not have to wait for its first ticket.
          </p>
        </div>
      </div>
    );
  }

  return (
    /*
     * The index OWNS ITS VIEWPORT (UI-SPEC §9.3, §5).
     *
     * `min-h-screen` here was the board fighting the shell. The route now renders inside
     * `<PageBody fullBleed>`, whose height is `<main>`'s — the viewport less the top bar — so a
     * 100vh minimum made this element TALLER than the box it sits in. The consequences were both
     * visible in the audit shot: the shell grew a second scrollbar, and the dark board could not
     * reach the viewport edge because it was floating inside `<main>`'s own 24px gutter. `h-full`
     * removes the fight instead of patching around it; the grid below, not this element, is the
     * scroll region.
     */
    <div
      data-surface="kds"
      data-testid="kds-station-index"
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden bg-kds-surface p-6 text-kds-text"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className={cn("font-bold text-kds-text", T_H1)}>Kitchen — Stations</h1>
        {/*
          THE PASS (F18). This is the only way into it from a kitchen screen, and it is here
          rather than in the sidebar deliberately: the expeditor works from the kitchen's own
          home screen, and every tile beside this button shows ONE station's queue — which is
          exactly the thing the pass exists to be the opposite of. The tiles answer "how much
          work is at PANTRY1"; this answers "is table H1 ready to go".
        */}
        <button
          type="button"
          onClick={() => router.push("/app/kitchen/expo")}
          data-testid="kds-open-pass"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-white/25 bg-kds-card px-4 py-2.5 font-bold tracking-wide text-kds-text",
            T_LABEL,
          )}
        >
          <ConciergeBell className="size-4" aria-hidden="true" />
          The Pass — every check, whole
        </button>
      </div>
      {/*
        DENSITY (38-05 task 5). Two stations used to occupy the top 300px of a 900px viewport
        and leave 600px of empty board underneath, because the grid was a fixed breakpoint
        ladder — `grid-cols-4` at 1280px regardless of whether the branch had four stations or
        two. A branch with two stations therefore got two 260px cards adrift in a 1160px row,
        each squeezing four stage counters into a width that could not hold the word PREPARING.

        Both axes are now derived from the CONTENT rather than from the breakpoint:

        - `auto-fit` + `minmax(18rem,1fr)` — the column count is however many 288px cards fit,
          and with fewer stations than columns the empty tracks COLLAPSE and the real cards take
          the width. Two stations at 1160px become two 570px cards instead of two 260px ones,
          which is what puts the counters back in a column wide enough for their labels.
          `min(18rem,100%)` so a container narrower than one card sizes the track to the
          container instead of overflowing it — at 320px there is no 288px to be had.
        - `auto-rows-[minmax(11rem,auto)]` + `content-start` — rows HUG THEIR CONTENT, with a
          176px floor. Stretching them was tried and measured, and it is the wrong answer: at
          1440x900 with two stations, `1fr` rows produced two 688x808 cards, which does not
          remove the 600px of void — it moves the void INSIDE the cards and draws a border round
          it. Two stations really is a short list, and a card inflated to hide that is a worse lie
          than the empty board underneath it. The floor still earns its place at the other end: a
          station with an empty queue has a shorter line than one showing an age, and without it
          the "Tickets by stage" strips of two cards in the same row sit at different heights.

        What the height DOES buy is the width. The measured defect was never the void; it was
        four counters crushed into a 260px card. At 1440px this goes 336px -> 688px per card,
        which is what puts PREPARING back in a cell wider than the word.

        The tile is a flex column with its counter block on `mt-auto`, so within the 176px floor
        every card's counters align on one line across the row rather than floating up under
        whatever the station's own status line happened to be.

        This layout is an INVENTION. The calibration demo has eleven screens and none of them is
        a kitchen board (D-38-15), so there is nothing here to calibrate against; the rule it
        follows is UI-SPEC §9.3 "column count adapts to viewport", not a demo recipe.
      */}
      <div
        data-testid="kds-station-grid"
        className="grid min-h-0 flex-1 auto-rows-[minmax(11rem,auto)] grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] content-start gap-4 overflow-y-auto"
      >
        {activeStations.map((station) => (
          <StationTile
            key={station.code}
            station={station}
            stats={stats.get(station.code)}
            now={now}
            onOpen={() => router.push(`/app/kitchen/${station.code}`)}
          />
        ))}
      </div>
    </div>
  );
}

interface StationTileProps {
  station: KdsStation;
  stats: KdsStationCounts | undefined;
  /** The shared 10-second KDS clock, passed down so every tile ages against ONE `now`. */
  now: number;
  onOpen: () => void;
}

function StationTile({ station, stats, now, onOpen }: StationTileProps) {
  const counts = stats ?? emptyKdsCounts();
  const { ticketCount, itemCount, oldestReceivedAtMs } = counts;
  const threshold = station.escalationThresholdSeconds || DEFAULT_ESCALATION_THRESHOLD_SECONDS;
  const busy = ticketCount > 0;
  const oldest = readOldest(oldestReceivedAtMs, now, threshold);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`station-tile-${station.code}`}
      className={cn(
        // `h-full flex-col` — the tile fills the row track the grid gave it, and the counter
        // block below rides `mt-auto` to the bottom of whatever height that is.
        // `@container` — the counter row below sizes itself against THIS card, not against the
        // viewport. With an `auto-fit` grid above, a 1440px viewport gives a 688px card at two
        // stations and a 336px card at eight, so a viewport breakpoint would be answering a
        // question about the wrong box.
        "@container flex h-full flex-col rounded-xl border p-5 text-left transition-colors",
        busy
          ? "border-white/25 bg-kds-card hover:border-kds-text"
          : "border-white/10 bg-kds-card/60 hover:border-white/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn("truncate font-bold text-kds-text", T_H1)}>{station.name}</h2>
          <p className={cn("mt-0.5 uppercase tracking-wide text-kds-muted", T_LABEL)}>
            {station.code}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 font-bold tabular-nums",
            T_SMALL,
            busy ? "bg-white/15 text-kds-text" : "bg-white/5 text-kds-muted",
          )}
          data-testid={`station-queue-${station.code}`}
          // The pill is the glance number, so it must not be a bare figure to a screen
          // reader either. Sighted readers get the unit spelled out on the line below.
          aria-label={`${ticketLabel(ticketCount)} at ${station.name}`}
        >
          {ticketCount}
        </span>
      </div>

      <div className={cn("mt-4 flex items-center gap-4", T_SMALL)}>
        <span
          className="inline-flex items-center gap-1.5 text-kds-muted"
          title="Checks on this station's board"
          data-testid={`station-tickets-${station.code}`}
        >
          <Layers className="size-4" aria-hidden="true" />
          {ticketLabel(ticketCount)}
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-kds-muted"
          title="Dishes still to prepare"
          data-testid={`station-items-${station.code}`}
        >
          <ChefHat className="size-4" aria-hidden="true" />
          {itemLabel(itemCount)}
        </span>
      </div>

      <div className={cn("mt-2 flex items-center gap-1.5", T_SMALL)}>
        {oldest === null ? (
          <span className="inline-flex items-center gap-1.5 text-kds-fresh">
            <Clock className="size-4" aria-hidden="true" />
            Clear
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              oldest.emphasise && "font-bold",
              oldest.toneClass,
            )}
            title={
              oldest.withinUrgencyWindow
                ? "Oldest ticket age"
                : "Older than a day — the date it was fired, not a countdown"
            }
            data-testid={`station-oldest-${station.code}`}
            // The bound as a DOM fact, so the gate can assert "no urgency treatment past 24h"
            // by querying rather than by reading a colour out of a screenshot.
            data-within-urgency-window={oldest.withinUrgencyWindow ? "true" : "false"}
            aria-label={oldest.srLabel}
          >
            <oldest.Icon
              className="size-4"
              aria-hidden="true"
              // Filled, like the board's own Flame: a solid mass reads differently from an
              // outline even in greyscale.
              fill={oldest.Icon === Flame ? "currentColor" : "none"}
            />
            <span aria-hidden="true">{oldest.text}</span>
          </span>
        )}
      </div>

      {/*
        Per-status breakdown (New / Started / Preparing / Ready).

        These used to be ITEM counts sitting directly opposite the board's CARD counts, which
        is how the same station read `97 NEW` here and `76 NEW` one click later. They are now
        the same cards the board's column headers count, from the same helper — and the
        caption below says which, because four bare numbers under four stage names invite
        exactly the inference that was wrong.

        `grid-cols-4` forced four columns into whatever width the card had — ~26px each at 1024px,
        against a `PREPARING` label that needs 63px at 11px uppercase. The label overflowed its
        cell and painted straight across its neighbour: the audit photographed `PREPARINGREADY` on
        both station cards, in both themes, at the widest viewport tested.

        `auto-fit` + `minmax` sizes the column from the LONGEST label instead of from the card, so
        the row re-flows to two columns when there is not room for four. The label never overflows,
        because the track is never narrower than the label — which is UI-SPEC §9.3's rule that the
        block "wraps or abbreviates by rule, never by overflow".

        4.75rem = 76px = PREPARING's 63px painted width + the cell's 12px horizontal padding, with
        a pixel to spare. Re-measured by `e2e/verify-38-wave3.mjs`, which compares PAINTED extent
        (`left + scrollWidth`) rather than box extent — box comparison reported 0 collisions
        against this very defect, because each box was dutifully 26px wide and 44px apart.

        `auto-fit` fixed the collision but left the wrap RAGGED: measured at 390px it produced
        three counters on one line and READY alone underneath, because 302px of card holds three
        76px tracks and not four. Nothing overlapped, but "wraps by rule" and "wraps wherever the
        arithmetic lands" are not the same contract, and a 3+1 row reads as though READY is a
        different kind of thing from the other three.

        So the wrap is now a RULE with exactly two outcomes, expressed as a container query on the
        card rather than a viewport breakpoint — the card's width is what the counters live in,
        and it depends on the station COUNT as much as on the viewport now that the grid above is
        `auto-fit`:

            four across  when the card can hold four   (>= 23rem)
            two by two   otherwise

        23rem = 368px is the arithmetic: 4 x 76px of label + 3 x 6px gap = 322px of grid, inside
        the card's 2 x 20px padding. Never three, never one, never ragged.

        `[overflow-wrap:anywhere]` stays underneath it as the last-resort guard, and it is the one
        that makes this true by construction rather than by arithmetic. 76px is a MEASUREMENT — of
        Sora, at 11px, at this tracking, in Chromium. A fallback face while the webfont loads, a
        user font scale, or a locale whose word for PREPARING is longer all move that number, and
        a word that no longer fits its track does not shrink: it paints straight across its
        neighbour, which is the `PREPARINGREADY` defect exactly. `anywhere` makes it WRAP instead.
        Two independent mechanisms, because the first one is only as good as the font it was
        measured in.
      */}
      <p
        className={cn("mt-auto pt-3 uppercase tracking-wide text-kds-muted", T_LABEL)}
        data-testid={`station-breakdown-caption-${station.code}`}
      >
        Tickets by stage
      </p>
      <div className="mt-1 grid grid-cols-2 gap-1.5 @min-[23rem]:grid-cols-4">
        {COLUMN_ORDER.map((col) => {
          const n = counts.columnTickets[col];
          return (
            <div
              key={col}
              className="min-w-0 rounded-md bg-white/5 px-1.5 py-1 text-center"
              data-testid={`station-${station.code}-col-${col}`}
            >
              <div
                className={cn(
                  "font-bold tabular-nums",
                  n > 0 ? "text-kds-text" : "text-kds-muted opacity-60",
                )}
                // A ticket with a started starter and an unstarted main is one ticket in two
                // columns, so these deliberately sum to more than the tile's own total. Saying
                // so out loud is cheaper than a cook adding them up and finding they do not.
                aria-label={`${KDS_COLUMN_LABELS[col]}: ${ticketLabel(n)}`}
              >
                {n}
              </div>
              <div
                className={cn(
                  "uppercase tracking-wide text-kds-muted [overflow-wrap:anywhere]",
                  T_LABEL,
                )}
                aria-hidden="true"
              >
                {KDS_COLUMN_LABELS[col]}
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

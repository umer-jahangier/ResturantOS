"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Clock, ConciergeBell, Layers, Timer } from "lucide-react";

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

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

/**
 * The same three ageing states the board uses, on the same tokens and the same fractions
 * (`kds-aging.ts`) — a station tile that says "amber" while the board says "late" is two
 * different products. Colour is never the only channel here either: the caller pairs this
 * with a distinct icon and the literal word.
 */
function ageTreatment(oldestAgeMs: number | null, thresholdSeconds: number): string {
  if (oldestAgeMs === null) return "text-kds-muted";
  const state = getAgingState(oldestAgeMs, thresholdSeconds);
  if (state === "late") return "text-kds-late";
  if (state === "warn") return "text-kds-warn";
  return "text-kds-fresh";
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
      <div data-surface="kds" className="min-h-screen bg-kds-surface p-6 text-kds-text">
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
          "flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted",
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
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kds-surface p-6 text-center"
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
    <div data-surface="kds" className="min-h-screen bg-kds-surface p-6 text-kds-text">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {activeStations.map((station) => (
          <StationTile
            key={station.code}
            station={station}
            stats={stats.get(station.code)}
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
  onOpen: () => void;
}

function StationTile({ station, stats, onOpen }: StationTileProps) {
  const counts = stats ?? emptyKdsCounts();
  const { ticketCount, itemCount, oldestAgeMs } = counts;
  const threshold = station.escalationThresholdSeconds || DEFAULT_ESCALATION_THRESHOLD_SECONDS;
  const busy = ticketCount > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`station-tile-${station.code}`}
      className={cn(
        "rounded-xl border p-5 text-left transition-colors",
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
        {oldestAgeMs === null ? (
          <span className="inline-flex items-center gap-1.5 text-kds-fresh">
            <Clock className="size-4" aria-hidden="true" />
            Clear
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-bold",
              ageTreatment(oldestAgeMs, threshold),
            )}
            title="Oldest ticket age"
            data-testid={`station-oldest-${station.code}`}
          >
            <Timer className="size-4" aria-hidden="true" />
            Oldest {formatAge(oldestAgeMs)}
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
      */}
      <p
        className={cn("mt-3 uppercase tracking-wide text-kds-muted", T_LABEL)}
        data-testid={`station-breakdown-caption-${station.code}`}
      >
        Tickets by stage
      </p>
      <div className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))] gap-1.5">
        {COLUMN_ORDER.map((col) => {
          const n = counts.columnTickets[col];
          return (
            <div
              key={col}
              className="rounded-md bg-white/5 px-1.5 py-1 text-center"
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
                className={cn("uppercase tracking-wide text-kds-muted", T_LABEL)}
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

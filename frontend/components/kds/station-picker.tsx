"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Clock, Layers, Timer } from "lucide-react";

import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { cn } from "@/lib/utils";
import { useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import {
  mapItemStatusToColumn,
  KDS_COLUMN_LABELS,
  type KdsColumnKey,
} from "@/components/kds/kds-item-column";
import { EmptyState } from "@/components/ui/empty-state";
import { getAgingState } from "@/components/kds/kds-aging";
import type { KdsStation, KdsTicket } from "@/lib/models/kds.model";

interface StationPickerProps {
  branchId: string;
}

interface StationStats {
  /** Active (non-terminal) tickets waiting at this station. */
  queueDepth: number;
  /** Total active items across those tickets. */
  itemCount: number;
  /** Age (ms) of the oldest active ticket, or null when the station is clear. */
  oldestAgeMs: number | null;
  /** Item counts per board column (New/Started/Preparing/Ready). */
  columnCounts: Record<KdsColumnKey, number>;
}

const DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900; // 15 min

// Non-terminal = still on the board. Must match StationBoard's board filter
// (`!== SERVED && !== CANCELLED`): a ticket flips to READY once all its items are
// ready and STAYS on the board (in the Ready column) until the order is served/closed,
// so READY tickets must be counted here too — otherwise the per-station Ready tally
// (and queueDepth) systematically undercounts fully-ready tickets.
function isActive(t: KdsTicket): boolean {
  return t.status !== "SERVED" && t.status !== "CANCELLED";
}

function emptyColumnCounts(): Record<KdsColumnKey, number> {
  return { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 };
}

/** Groups active tickets by station code into per-station stats (KDS main-screen). */
function computeStationStats(tickets: KdsTicket[], now: number): Map<string, StationStats> {
  const byStation = new Map<string, StationStats>();
  for (const ticket of tickets) {
    if (!isActive(ticket)) continue;
    const prev = byStation.get(ticket.stationCode) ?? {
      queueDepth: 0,
      itemCount: 0,
      oldestAgeMs: null,
      columnCounts: emptyColumnCounts(),
    };
    const ageMs = now - ticket.receivedAt.getTime();
    // Tally items into board columns (New/Started/Preparing/Ready); skip cancelled/unmapped.
    let liveItems = 0;
    for (const item of ticket.items) {
      const col = mapItemStatusToColumn(item.status);
      if (!col) continue;
      prev.columnCounts[col] += 1;
      liveItems += 1;
    }
    byStation.set(ticket.stationCode, {
      queueDepth: prev.queueDepth + 1,
      itemCount: prev.itemCount + liveItems,
      oldestAgeMs: prev.oldestAgeMs === null ? ageMs : Math.max(prev.oldestAgeMs, ageMs),
      columnCounts: prev.columnCounts,
    });
  }
  return byStation;
}

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
  const stats = useMemo(() => computeStationStats(tickets, now), [tickets, now]);

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
        className="flex min-h-screen items-center justify-center bg-kds-surface"
      >
        <EmptyState
          icon={ChefHat}
          title="No active stations configured"
          className="text-kds-text"
        />
      </div>
    );
  }

  return (
    <div data-surface="kds" className="min-h-screen bg-kds-surface p-6 text-kds-text">
      <h1 className={cn("mb-6 font-bold text-kds-text", T_H1)}>Kitchen — Stations</h1>
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
  stats: StationStats | undefined;
  onOpen: () => void;
}

function StationTile({ station, stats, onOpen }: StationTileProps) {
  const queueDepth = stats?.queueDepth ?? 0;
  const itemCount = stats?.itemCount ?? 0;
  const oldestAgeMs = stats?.oldestAgeMs ?? null;
  const threshold = station.escalationThresholdSeconds || DEFAULT_ESCALATION_THRESHOLD_SECONDS;
  const busy = queueDepth > 0;

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
        >
          {queueDepth}
        </span>
      </div>

      <div className={cn("mt-4 flex items-center gap-4", T_SMALL)}>
        <span className="inline-flex items-center gap-1.5 text-kds-muted" title="Tickets in queue">
          <Layers className="size-4" aria-hidden="true" />
          {queueDepth} {queueDepth === 1 ? "ticket" : "tickets"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-kds-muted" title="Items to prepare">
          <ChefHat className="size-4" aria-hidden="true" />
          {itemCount} {itemCount === 1 ? "item" : "items"}
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

      {/* Per-status breakdown (New / Started / Preparing / Ready) */}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {COLUMN_ORDER.map((col) => {
          const n = stats?.columnCounts[col] ?? 0;
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
              >
                {n}
              </div>
              <div className={cn("uppercase tracking-wide text-kds-muted", T_LABEL)}>
                {KDS_COLUMN_LABELS[col]}
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

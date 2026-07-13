"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Clock, Layers, Timer } from "lucide-react";

import { useKdsStations, useKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { mapItemStatusToColumn, KDS_COLUMN_LABELS, type KdsColumnKey } from "@/components/kds/kds-item-column";
import { EmptyState } from "@/components/ui/empty-state";
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
    const prev = byStation.get(ticket.stationCode)
      ?? { queueDepth: 0, itemCount: 0, oldestAgeMs: null, columnCounts: emptyColumnCounts() };
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

/** Amber past 0.66× the station's escalation threshold, red past 1.0×. */
function ageTreatment(oldestAgeMs: number | null, thresholdSeconds: number): string {
  if (oldestAgeMs === null) return "text-gray-500";
  const fraction = oldestAgeMs / (thresholdSeconds * 1000);
  if (fraction >= 1) return "text-red-400";
  if (fraction >= 0.66) return "text-amber-400";
  return "text-emerald-400";
}

/**
 * KDS station picker + live overview (KDS-04/D-12, #6 station stats) — `kitchen/`
 * route. Each tile shows the station's live queue depth, item count, and oldest-ticket
 * age (amber/red as it approaches/exceeds the station's escalation threshold) instead of
 * a bare name. A single station still auto-navigates straight to its isolated board.
 */
export function StationPicker({ branchId }: StationPickerProps) {
  const router = useRouter();
  const { data: stations = [], isLoading } = useKdsStations(branchId);
  const { data: tickets = [] } = useKdsTickets(branchId);

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const singleStation = activeStations.length === 1 ? activeStations[0] : null;
  // Recomputed each render; useKdsTickets' 10s poll re-renders and freshens the age.
  const stats = useMemo(() => computeStationStats(tickets, Date.now()), [tickets]);

  useEffect(() => {
    if (singleStation) {
      router.replace(`/app/kitchen/${singleStation.code}`);
    }
  }, [singleStation, router]);

  if (isLoading || singleStation) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-500 text-lg">
        Loading stations…
      </div>
    );
  }

  if (activeStations.length === 0) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center">
        <EmptyState icon={ChefHat} title="No active stations configured" className="text-gray-100" />
      </div>
    );
  }

  return (
    <div className="dark bg-gray-950 min-h-screen p-6">
      <h1 className="text-white text-2xl font-bold mb-6">Kitchen — Stations</h1>
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
      className={`rounded-xl border p-5 text-left transition-colors ${
        busy ? "border-gray-600 bg-gray-900 hover:border-gray-400" : "border-gray-800 bg-gray-900/60 hover:border-gray-600"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-white font-bold text-lg truncate">{station.name}</h2>
          <p className="text-gray-500 text-xs mt-0.5 uppercase tracking-wide">{station.code}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${
            busy ? "bg-primary/20 text-primary" : "bg-gray-800 text-gray-500"
          }`}
          data-testid={`station-queue-${station.code}`}
        >
          {queueDepth}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 text-gray-400" title="Tickets in queue">
          <Layers className="size-4" aria-hidden="true" />
          {queueDepth} {queueDepth === 1 ? "ticket" : "tickets"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-gray-400" title="Items to prepare">
          <ChefHat className="size-4" aria-hidden="true" />
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-sm">
        {oldestAgeMs === null ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400/80">
            <Clock className="size-4" aria-hidden="true" />
            Clear
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 font-medium ${ageTreatment(oldestAgeMs, threshold)}`}
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
              className="rounded-md bg-gray-800/70 px-1.5 py-1 text-center"
              data-testid={`station-${station.code}-col-${col}`}
            >
              <div className={`text-base font-bold tabular-nums ${n > 0 ? "text-white" : "text-gray-600"}`}>{n}</div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{KDS_COLUMN_LABELS[col]}</div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

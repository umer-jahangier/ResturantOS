"use client";

import { useMemo } from "react";

import { useKdsTickets, useKdsStations } from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { KdsClockProvider } from "@/lib/hooks/kds/use-kds-clock";
import { KdsItemColumn, KDS_COLUMN_ORDER } from "@/components/kds/kds-item-column";
import type { KdsTicket } from "@/lib/models/kds.model";

/**
 * Deterministic, stable board sort (KDS-03 — carried forward unchanged from the
 * pre-07.3-10 KdsBoard/StationColumn this component supersedes): receivedAt
 * ascending, ties broken by ticket.id. A pure function of each ticket's immutable
 * receivedAt/id — never looks at mutable per-item status — so a card's position
 * never changes when only its items' statuses update within an already-rendered
 * ticket. Exported for kds-board-sort.test.ts.
 */
export function sortKdsTickets<T extends Pick<KdsTicket, "id" | "receivedAt">>(
  tickets: readonly T[],
): T[] {
  return [...tickets].sort((a, b) => {
    const diff = a.receivedAt.getTime() - b.receivedAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

interface StationBoardProps {
  branchId: string;
  stationCode: string;
}

/**
 * Station-isolated KDS board (KDS-04/D-12) — `kitchen/[stationCode]` route. Four
 * item-status columns (New/Started/Preparing/Ready), item-centric so a
 * mixed-status order shows fragments in each relevant column. Always-dark — does
 * NOT respect useTheme() (kitchen readability at 2m, 07-04-D). Combines HTTP
 * polling + WebSocket for live updates (reused from the pre-07.3-10 board).
 * KdsClockProvider wraps the whole board so every card fragment shares ONE
 * setInterval (KDS-05/D-13) instead of one per card.
 */
export function StationBoard({ branchId, stationCode }: StationBoardProps) {
  const { data: tickets = [], isLoading } = useKdsTickets(branchId, stationCode);
  const { data: stations = [] } = useKdsStations(branchId);
  const { isConnected } = useKdsSocket({ branchId, stationCode });
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");

  const station = stations.find((s) => s.code === stationCode);

  // Only PENDING/COOKING tickets are "active" on the board — a READY ticket
  // lingers briefly (auto-remove window) matching the pre-07.3-10 board's filter.
  const activeTickets = useMemo(
    () => sortKdsTickets(tickets.filter((t) => t.status === "PENDING" || t.status === "COOKING")),
    [tickets],
  );

  if (isLoading) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-500 text-lg">
        Loading station…
      </div>
    );
  }

  return (
    <KdsClockProvider>
      <div className="dark bg-gray-950 min-h-screen p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 border border-gray-700">
          <h1 className="text-white font-bold text-lg tracking-wide">{station?.name ?? stationCode}</h1>
          <span
            className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`}
            title={isConnected ? "Live" : "Polling"}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {KDS_COLUMN_ORDER.map((column) => (
            <KdsItemColumn
              key={column}
              column={column}
              tickets={activeTickets}
              branchId={branchId}
              canUpdate={canUpdate}
              escalationThresholdSeconds={station?.escalationThresholdSeconds}
            />
          ))}
        </div>
      </div>
    </KdsClockProvider>
  );
}

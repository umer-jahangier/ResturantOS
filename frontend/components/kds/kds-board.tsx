"use client";

import { useKdsTickets, useKdsStations } from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { KdsStation } from "@/lib/models/kds.model";

interface KdsBoardProps {
  branchId: string;
}

/**
 * Always-dark KDS board — does NOT respect useTheme().
 * Renders one column per active station.
 * Combines HTTP polling + WebSocket for ≤2s live updates.
 */
export function KdsBoard({ branchId }: KdsBoardProps) {
  const { data: stations = [], isLoading: stationsLoading } = useKdsStations(branchId);
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");

  if (stationsLoading) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-500 text-lg">
        Loading stations…
      </div>
    );
  }

  const activeStations = stations.filter((s) => s.active);

  if (activeStations.length === 0) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-500 text-lg">
        No active stations configured.
      </div>
    );
  }

  const colClass =
    activeStations.length === 1
      ? "grid-cols-1"
      : activeStations.length === 2
        ? "grid-cols-2"
        : activeStations.length === 3
          ? "grid-cols-3"
          : "grid-cols-4";

  return (
    <div className={`dark bg-gray-950 min-h-screen p-4 grid ${colClass} gap-4`}>
      {activeStations.map((station) => (
        <StationColumn
          key={station.code}
          branchId={branchId}
          station={station}
          canUpdate={canUpdate}
        />
      ))}
    </div>
  );
}

interface StationColumnProps {
  branchId: string;
  station: KdsStation;
  canUpdate: boolean;
}

function StationColumn({ branchId, station, canUpdate }: StationColumnProps) {
  const { data: tickets = [] } = useKdsTickets(branchId, station.code);
  const { isConnected } = useKdsSocket({ branchId, stationCode: station.code });

  const activeTickets = tickets.filter(
    (t) => t.status === "PENDING" || t.status === "COOKING",
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Station header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 border border-gray-700">
        <h2 className="text-white font-bold text-lg tracking-wide">{station.name}</h2>
        <span
          className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`}
          title={isConnected ? "Live" : "Polling"}
        />
      </div>

      {/* Ticket cards */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        {activeTickets.length === 0 ? (
          <div className="text-center text-gray-600 py-8 text-sm">All clear ✓</div>
        ) : (
          activeTickets.map((ticket) => (
            <KdsTicketCard
              key={ticket.id}
              ticket={ticket}
              branchId={branchId}
              canUpdate={canUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutGrid } from "lucide-react";

import { useKdsTickets, useKdsStations } from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { KdsClockProvider } from "@/lib/hooks/kds/use-kds-clock";
import { KdsItemColumn, KDS_COLUMN_ORDER } from "@/components/kds/kds-item-column";
import type { KdsTicket } from "@/lib/models/kds.model";

/**
 * Deterministic, stable board sort: receivedAt DESCENDING (newest ticket first, so a new
 * order always lands at the top of its column), ties broken by ticket.id. A pure function of
 * each ticket's immutable receivedAt/id — never looks at mutable per-item status — so a card's
 * position never changes when only its items' statuses update within an already-rendered
 * ticket. Exported for kds-board-sort.test.ts.
 */
export function sortKdsTickets<T extends Pick<KdsTicket, "id" | "receivedAt">>(
  tickets: readonly T[],
): T[] {
  return [...tickets].sort((a, b) => {
    const diff = b.receivedAt.getTime() - a.receivedAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

interface StationBoardProps {
  branchId: string;
  stationCode: string;
}

interface StationSwitcherProps {
  stations: { code: string; name: string }[];
  currentCode: string;
  onSelect: (code: string) => void;
}

/**
 * Station switcher (#7) — lets a terminal "reflect"/switch which station's board it
 * shows without going back to the picker. Native <select> for reliable touch behaviour
 * on kitchen hardware; hidden when the branch has a single station (nothing to switch).
 */
function StationSwitcher({ stations, currentCode, onSelect }: StationSwitcherProps) {
  if (stations.length <= 1) return null;
  return (
    <div className="relative">
      <select
        value={currentCode}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Switch station"
        data-testid="kds-station-switcher"
        className="appearance-none rounded-md border border-gray-600 bg-gray-900 py-1 pl-2.5 pr-7 text-sm font-medium text-gray-200 hover:border-gray-500 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {stations.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1/2 size-4 -translate-y-1/2 text-gray-400"
        aria-hidden="true"
      />
    </div>
  );
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
  const router = useRouter();
  const { data: tickets = [], isLoading } = useKdsTickets(branchId, stationCode);
  const { data: stations = [] } = useKdsStations(branchId);
  const { isConnected } = useKdsSocket({ branchId, stationCode });
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");

  const station = stations.find((s) => s.code === stationCode);
  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);

  // Active board = everything not terminal. READY tickets STAY visible (in the Ready column)
  // until the order is served/closed — the ORDER_CLOSED consumer flips them to SERVED, which
  // (with CANCELLED) is what drops them off the board.
  const activeTickets = useMemo(
    () => sortKdsTickets(tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED")),
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
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-white font-bold text-lg tracking-wide truncate">{station?.name ?? stationCode}</h1>
            {/* Station switcher (#7) — "reflect"/switch which station this terminal shows. */}
            <StationSwitcher
              stations={activeStations}
              currentCode={stationCode}
              onSelect={(code) => router.push(`/app/kitchen/${code}`)}
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/app/kitchen")}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700 transition-colors"
              data-testid="kds-all-stations"
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
              All stations
            </button>
            <span
              className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`}
              title={isConnected ? "Live" : "Polling"}
            />
          </div>
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

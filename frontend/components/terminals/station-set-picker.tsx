"use client";

import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import { stationTypeLabel, stationTypeScreen } from "@/components/stations/station-type-select";

/**
 * Which stations this terminal fires to.
 *
 * <p>Same none-means-all rule as the menu scope, and the same reason for saying it in a visible
 * sentence rather than leaving an empty list to be interpreted. Reuses plan 28-06's station hook —
 * the branch's ACTIVE stations, because firing to a retired station is firing at a screen nobody
 * watches — and 28-06's type labels, so a station reads the same here as it does on the Stations
 * screen and on the account form.
 */
export function StationSetPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (stationIds: string[]) => void;
  disabled?: boolean;
}) {
  const stations = useStations();
  const offered = stations.data ?? [];
  const selectedNames = offered.filter((s) => value.includes(s.id)).map((s) => s.name);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((s) => s !== id) : [...value, id]);
  }

  return (
    <div data-testid="station-set-picker" className="space-y-2">
      <p data-testid="station-set-summary" className="text-xs text-muted-foreground">
        {selectedNames.length === 0
          ? "Tick nothing and this terminal fires to every station in the branch."
          : `This terminal fires to ${formatList(selectedNames)} only.`}
      </p>

      {stations.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : stations.isError ? (
        <QueryErrorNotice
          what="this branch's stations"
          error={stations.error}
          onRetry={() => void stations.refetch()}
          isRetrying={stations.isFetching}
        />
      ) : offered.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This branch has no stations yet. Add one on the Stations screen; until then every terminal
          fires everywhere.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {offered.map((station) => (
            <li key={station.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={value.includes(station.id)}
                  disabled={disabled}
                  onChange={() => toggle(station.id)}
                />
                <span className="min-w-0 flex-1 truncate">{station.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {stationTypeLabel(station.stationType)} — {stationTypeScreen(station.stationType)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

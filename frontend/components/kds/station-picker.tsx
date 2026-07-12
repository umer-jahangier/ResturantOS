"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChefHat } from "lucide-react";

import { useKdsStations } from "@/lib/hooks/kds/use-kds-tickets";
import { EmptyState } from "@/components/ui/empty-state";

interface StationPickerProps {
  branchId: string;
}

/**
 * KDS station picker (KDS-04/D-12) — `kitchen/` route. Lists active (seeded)
 * stations for the branch; a single station auto-navigates straight to its
 * isolated board. The DEFAULT-station auto-seed-on-miss (07.3-05) means the
 * board is never empty on a fresh branch — the EmptyState below only renders
 * when a branch truly has zero active stations (should not happen in practice).
 */
export function StationPicker({ branchId }: StationPickerProps) {
  const router = useRouter();
  const { data: stations = [], isLoading } = useKdsStations(branchId);

  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);
  const singleStation = activeStations.length === 1 ? activeStations[0] : null;

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
      <h1 className="text-white text-2xl font-bold mb-6">Select a Station</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {activeStations.map((station) => (
          <button
            key={station.code}
            type="button"
            onClick={() => router.push(`/app/kitchen/${station.code}`)}
            className="rounded-xl border border-gray-700 bg-gray-900 p-6 text-left hover:border-gray-500 transition-colors"
            data-testid={`station-tile-${station.code}`}
          >
            <h2 className="text-white font-bold text-lg">{station.name}</h2>
            <p className="text-gray-500 text-xs mt-1 uppercase tracking-wide">{station.code}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

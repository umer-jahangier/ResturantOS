"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";
import type { DashboardTile } from "@/lib/models/reporting.model";

function secondsAgo(computedAt: string): number {
  const then = new Date(computedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}

function TileValue({ tile }: { tile: DashboardTile }) {
  // Guard the divide-by-zero tile (average-order-value): null means "not applicable", never 0.
  if (tile.valuePaisa === null && tile.valueNumber === null) {
    return <span className="text-3xl font-semibold tabular-nums">—</span>;
  }
  if (tile.valuePaisa !== null) {
    return <MoneyDisplay paisa={tile.valuePaisa} className="text-3xl font-semibold" />;
  }
  return <span className="text-3xl font-semibold tabular-nums">{tile.valueNumber}</span>;
}

function Tile({ tile }: { tile: DashboardTile }) {
  // Re-render every few seconds so "updated Ns ago" stays fresh without a full data refetch.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-2 rounded-lg border border-border p-6">
      <p className="text-sm text-muted-foreground">{tile.title}</p>
      <TileValue tile={tile} />
      <p className="text-xs text-muted-foreground">updated {secondsAgo(tile.computedAt)}s ago</p>
    </div>
  );
}

interface DashboardTileGridProps {
  tiles: DashboardTile[] | undefined;
  isLoading: boolean;
}

export function DashboardTileGrid({ tiles, isLoading }: DashboardTileGridProps) {
  if (isLoading && !tiles) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (!tiles || tiles.length === 0) {
    return <p className="text-sm text-muted-foreground">No tiles yet — waiting for today&apos;s first order.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <Tile key={tile.tileId} tile={tile} />
      ))}
    </div>
  );
}

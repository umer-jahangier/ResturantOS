"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { ELAPSED_ABSOLUTE_BOUND_MS, readElapsed } from "@/lib/format/elapsed";
import { formatNumber } from "@/lib/format/locale";
import type { DashboardTile } from "@/lib/models/reporting.model";

/**
 * The realtime dashboard's tiles, on the product's one KPI primitive.
 *
 * <h3>What this was</h3>
 *
 * A hand-rolled `div` card with a raw `text-3xl` value, `text-sm` title and `text-xs` footer —
 * three off-contract type roles on a screen sitting beside `/app/dashboard`, which renders the
 * same class of figure through `StatTile` at `--text-display`. Two dashboards, two visual
 * languages, no plan owning the difference (N12). It is `StatTile` now, which brings the
 * uppercase label, the display-scale figure, the accent rail and — the part that matters —
 * the type-level refusal to render a figure the system does not have.
 *
 * <h3>A tile with neither value renders an ABSENCE, and the reason is the contract's own</h3>
 *
 * `apiDashboardTileSchema` is explicit that exactly one of `valuePaisa`/`valueNumber` is
 * populated and the other is `null` — *"never 0 (0 is a real value; `null` means 'not
 * applicable', e.g. `average-order-value` when `todays-orders` is 0)"*. The old code met that
 * halfway: it printed a bare `—` at `text-3xl` with no explanation, so a manager saw a dash and
 * had to guess whether the number was zero, broken or still loading. `StatTile`'s
 * `unavailableReason` says which it is (D-38-16). The reason quotes the contract and does not
 * elaborate: this component knows the figure is not applicable and does NOT know why, and
 * inventing "no orders yet today" would be asserting a cause it cannot see.
 *
 * <h3>One freshness line, not one per tile — and it reports the OLDEST</h3>
 *
 * Every tile used to carry its own `updated Ns ago` and its own 5-second interval: four timers
 * repainting four footers with the same number. Freshness is a property of the SNAPSHOT, so it
 * is stated once, under the grid. It is computed from the OLDEST `computedAt` in the set, which
 * is the only figure that is true of all of them — quoting the newest would let one stale tile
 * hide behind three fresh ones, which is the exact shape of lie this phase is about.
 *
 * <p>It is rendered through `lib/format/elapsed.ts`, the one bounded elapsed formatter, so a
 * dashboard left open over a weekend reads `Computed 2d ago` and then names the day, instead of
 * counting up to `188400s ago`.
 *
 * <h3>The clock is state written by a timer, never read during render</h3>
 *
 * Two of this repo's lint rules meet on this one line and only one shape satisfies both.
 * `react-hooks/purity` forbids `Date.now()` in a render — a component that reads the wall clock
 * while rendering produces a different answer every time React happens to re-render it, and
 * under Next it also produces one answer in the prerender and another in the hydration, which is
 * a text mismatch on a number that changes every second. `react-hooks/set-state-in-effect`
 * forbids the usual escape hatch of seeding it from the effect body. So the clock lives in state
 * and is written only from timer callbacks; until the first one fires the line is simply absent,
 * which is the honest rendering of "this component does not know what time it is yet" and is
 * also what makes the server and the client agree at first paint.
 */

function TileValue({ tile }: { tile: DashboardTile }) {
  if (tile.valuePaisa !== null) return <MoneyDisplay paisa={tile.valuePaisa} />;
  return <>{formatNumber(tile.valueNumber)}</>;
}

function freshnessSentence(oldestComputedAt: string, now: number): string {
  const reading = readElapsed(oldestComputedAt, now);
  if (reading.ageMs === null) return "These figures carry no readable timestamp.";
  // Past a month `long` is already an absolute date, and "computed 7 Aug 2026 ago" is not English.
  if (reading.ageMs >= ELAPSED_ABSOLUTE_BOUND_MS) return `Computed ${reading.long}.`;
  return `Computed ${reading.long} ago.`;
}

/** The oldest stamp in the set — the only freshness claim that is true of every tile. */
function oldestComputedAt(tiles: readonly DashboardTile[]): string | null {
  let oldest: { at: string; ms: number } | null = null;
  for (const tile of tiles) {
    const ms = new Date(tile.computedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (oldest === null || ms < oldest.ms) oldest = { at: tile.computedAt, ms };
  }
  return oldest?.at ?? null;
}

interface DashboardTileGridProps {
  tiles: DashboardTile[] | undefined;
  isLoading: boolean;
}

export function DashboardTileGrid({ tiles, isLoading }: DashboardTileGridProps) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (isLoading && !tiles) {
    return (
      <div className="grid gap-(--space-md) sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (!tiles || tiles.length === 0) {
    return (
      <EmptyState
        title="No tiles yet"
        description="Nothing has been computed for today. The board fills in as soon as the first order or till closes."
      />
    );
  }

  const oldest = oldestComputedAt(tiles);

  return (
    <div className="space-y-(--space-md)">
      <div className="grid gap-(--space-md) sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile, index) =>
          tile.valuePaisa === null && tile.valueNumber === null ? (
            <StatTile
              key={tile.tileId}
              label={tile.title}
              unavailableReason="Not applicable for today's figures"
              accent={index === 0 ? "primary" : "none"}
            />
          ) : (
            <StatTile
              key={tile.tileId}
              label={tile.title}
              value={<TileValue tile={tile} />}
              accent={index === 0 ? "primary" : "none"}
            />
          ),
        )}
      </div>

      {now !== null && oldest !== null && (
        <p className="text-small text-foreground-tertiary" data-testid="dashboard-tiles-freshness">
          {freshnessSentence(oldest, now)}
        </p>
      )}
    </div>
  );
}

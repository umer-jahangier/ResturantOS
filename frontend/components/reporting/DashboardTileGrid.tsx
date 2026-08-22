"use client";

import { useEffect, useState } from "react";
import { Banknote, Percent, Receipt, ReceiptText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile, type StatTileAccent } from "@/components/ui/stat-tile";
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

/**
 * Four across, not three.
 *
 * <p>`DashboardTileService.queryTiles` returns exactly FOUR tiles and has since it was written
 * (`todays-revenue`, `todays-orders`, `todays-tax`, `average-order-value`), so a three-column grid
 * put one tile alone on a second row at every desktop width — the 3-2 orphan the portlet grid's
 * own docblock warns about, shipped. Four matches the role dashboards' KPI row, which is the
 * point: this page and `/app/dashboard` should not look like two different products.
 */
const TILE_GRID = "grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4";

/**
 * The hue rotation. Four tiles in one accent is the flat read the demo comparison rejected; four
 * DIFFERENT hues let a reader find "today's tax" without reading all four labels.
 *
 * <p>`StatTile` offers three accents, so the fourth tile is deliberately the quiet one rather
 * than a repeat — a repeated hue in a row of four reads as a relationship between those two
 * tiles, and there is none.
 */
const TILE_ACCENTS: readonly StatTileAccent[] = ["primary", "secondary", "primary", "none"];

function accentFor(index: number): StatTileAccent {
  return TILE_ACCENTS[index % TILE_ACCENTS.length] ?? "none";
}

/**
 * Glyphs for the tile ids this service actually emits, and nothing else.
 *
 * <p>Keyed by `tileId` rather than by index, because the index is the server's ordering and a
 * glyph that moves when the ordering changes is worse than no glyph. An unknown id gets
 * `undefined`, and `StatTile` draws no chip at all — a tile whose subject we cannot name does not
 * get a guessed picture of it.
 */
const TILE_ICON: Record<string, React.ComponentType<{ className?: string }> | undefined> = {
  "todays-revenue": Banknote,
  "todays-orders": ReceiptText,
  "todays-tax": Percent,
  "average-order-value": Receipt,
};

interface DashboardTileGridProps {
  tiles: DashboardTile[] | undefined;
  isLoading: boolean;
  /**
   * Whether the query that produced `tiles` FAILED.
   *
   * <h3>GA-001, one screen further on</h3>
   *
   * This component used to take `tiles` and `isLoading` and nothing else, and it drew the
   * conclusion the API could not support: `if (!tiles || tiles.length === 0)` rendered *"No tiles
   * yet — nothing has been computed for today"*. A failed request also produces `undefined` tiles
   * with `isLoading` false, so a manager whose reporting service was down was told, in the
   * product's own confident voice, that their restaurant had taken no orders. That is the
   * fourteen-b defect exactly, on the realtime dashboard, and it survived because the failure
   * never reached this file — the page destructured `isLoading` and dropped `isError` one line
   * later (bug shape 2 from `query-boundary.tsx`'s own header).
   *
   * <p>So the failure is a REQUIRED part of this component's input. A caller cannot forget it the
   * way they could forget to destructure it, and "is it empty?" is not asked until the query has
   * resolved without error.
   */
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function DashboardTileGrid({
  tiles,
  isLoading,
  isError,
  error,
  onRetry,
  isRetrying,
}: DashboardTileGridProps) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Error FIRST, before loading and before empty, for the reason `QueryBoundary` gives at length:
  // a query that has failed has no trustworthy `tiles`, so "is it empty?" is not a question that
  // can be honestly asked yet.
  if (isError) {
    return (
      <QueryErrorNotice
        what="today's figures"
        error={error}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }

  if (isLoading && !tiles) {
    return (
      <div className={TILE_GRID}>
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
      <div className={TILE_GRID}>
        {tiles.map((tile, index) =>
          tile.valuePaisa === null && tile.valueNumber === null ? (
            <StatTile
              key={tile.tileId}
              label={tile.title}
              unavailableReason="Not applicable for today's figures"
              accent={accentFor(index)}
              icon={TILE_ICON[tile.tileId]}
            />
          ) : (
            <StatTile
              key={tile.tileId}
              label={tile.title}
              value={<TileValue tile={tile} />}
              accent={accentFor(index)}
              icon={TILE_ICON[tile.tileId]}
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

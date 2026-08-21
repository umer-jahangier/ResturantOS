"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import { useTables } from "@/lib/hooks/pos/use-orders";
import { useTableDetail } from "@/lib/hooks/pos/use-tables";
import {
  OrderTableDetailDrawer,
  type FullMenuTarget,
} from "@/components/pos/order-table-detail-drawer";
import { TABLE_STATUS, TABLE_STATUS_ORDER } from "@/components/pos/table-status-chip";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { readElapsed } from "@/lib/format/elapsed";
import type { DiningTable, TableStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TableFloorViewProps {
  /**
   * Fires ONLY on an AVAILABLE-table tap (UI-SPEC §2): the caller (page.tsx, plan 06)
   * binds the page-level `selectedTableId` and switches to the Terminal tab so a new
   * DRAFT order is created against that table. OCCUPIED/NEEDS_BUSSING taps never call
   * this — they open the shared Order/Table Detail drawer locally instead (below).
   */
  onTableSelect?: (table: DiningTable) => void;
  /**
   * "Full Menu →" out of the OCCUPIED/NEEDS_BUSSING detail drawer. This was NOT forwarded
   * before, so the drawer's own Full Menu button was a no-op on the floor tab — an
   * optional-chained callback that was never supplied, i.e. a button that did nothing at
   * all when tapped. Forwarding it lets a waiter resume the table's live order in the
   * terminal (S0-09).
   */
  onFullMenu?: (target: FullMenuTarget) => void;
}

/** Tables with no section, kept together and always shown last. Mirrors `/app/tables`. */
const UNSECTIONED = "Other tables";

/**
 * How often an occupied tile re-reads the clock for its "open for" figure.
 *
 * <p>Data freshness, not motion. D-38-04 forbids attention-seeking animation on the
 * `operational` zone, and `formatElapsedCompact` already refuses to render seconds above an hour
 * for exactly that reason. Thirty seconds is the coarsest tick that keeps a sub-hour `mm:ss`
 * honest in front of a waiter; anything slower and the number on the tile is quietly wrong.
 */
const FLOOR_TICK_MS = 30_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * <h3>"No tables configured" — the diagnosis (38-01)</h3>
 *
 * The audit found the POS Floor View reporting *"No tables configured"* while `/app/tables`
 * listed five tables (G1, T1, T2, T3, H1) for the same branch, and asked which surface was
 * lying. Measured against the live gateway as branch manager on branch `34cd6f62-…`:
 *
 * ```
 * GET /api/v1/pos/tables?branchId=…                   → 5 rows, all active=true
 * GET /api/v1/pos/tables?branchId=…&includeInactive=true → 9 rows (5 active + 4 retired E2E-*)
 * ```
 *
 * **The backend is correct and `/app/tables` is correct. This component was lying** — and not
 * about tables. It was lying about a *failure*, via the exact defect `QueryBoundary`'s own
 * docblock names as bug shape 2 (GA-001):
 *
 * ```ts
 * const { data: tables = [], isLoading } = useTables();   // isError never destructured
 * if (tables.length === 0) return <>No tables configured</>;
 * ```
 *
 * `isError` was never read, so a failed request became a zero-length array one line later. And
 * there is a second, subtler path to the same false message that has nothing to do with errors:
 * `useTables` is `enabled: isAuthenticated && !!branchId`. In TanStack Query v5 a **disabled**
 * query reports `isPending: true` but `isLoading: false` (`isLoading === isPending &&
 * isFetching`). Guarding on `isLoading` alone therefore falls straight through to the empty
 * state during session bootstrap, before `branchId` resolves — which is why the dashboard,
 * reading the *same* hook through a `QueryBoundary`, correctly showed "0 / 5 tables occupied"
 * on the same page load that this told the operator the restaurant had no tables.
 *
 * `QueryBoundary` handles both: it checks `isError` first, and its `isBusy` prefers `isPending`.
 * Using it here is not a style change, it is the fix. **This is the state 38-06 inherited: the
 * defect UI-SPEC §9.4 calls "blocked, and blocked on a defect" was diagnosed and closed in
 * 38-01, so this plan improves the floor view rather than designing around a lie.**
 *
 * <h3>What 38-06 added, and the thing it deliberately did NOT do</h3>
 *
 * The demo's floor "plan" is a strip of **seven 38×38px hard-coded chips** in the POS header
 * (DEMO-SCREENS §4, `:790-792`) with three states painted by class name and no data behind any
 * of them. It is smaller than a WCAG 2.2 target, it is not a floor, and adopting it would have
 * been a downgrade: this view already renders every real table at an ≥80px touch tile with four
 * channels per state. **It is a negative reference and was not adopted** (D-38-15).
 *
 * What was added is what real data supports and the screen was not yet saying: section grouping,
 * a reconciling count line, the running bill and the age of the open check on an occupied tile,
 * and — the part that matters most — an explicit statement of which of brief §17's states this
 * product cannot yet show and why (D-38-16: a fact we cannot compute is rendered as an absence
 * with a reason, never as an empty badge or a zero).
 */
export function TableFloorView({ onTableSelect, onFullMenu }: TableFloorViewProps) {
  const tablesQuery = useTables();
  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const now = useNow(FLOOR_TICK_MS);
  // OCCUPIED/NEEDS_BUSSING tap target — the SAME shared drawer used by Order Management
  // (plan 09), resolved by tableId. Never a second table-detail UI (UI-SPEC hard rule).
  const [detailTable, setDetailTable] = useState<DiningTable | null>(null);

  const handleTap = (table: DiningTable) => {
    if (table.status === "AVAILABLE") {
      onTableSelect?.(table);
      return;
    }
    setDetailTable(table);
  };

  /**
   * The header's count line. Every figure is a count of the TILES BELOW IT — the per-status
   * counts sum to the total by construction, and `seatsFree` is the capacity of exactly the
   * tiles showing "Available". A summary that disagrees with the thing it summarises is worse
   * than no summary.
   */
  const summary = useMemo(() => {
    const byStatus = new Map<TableStatus, number>();
    let seatsFree = 0;
    for (const table of tables) {
      byStatus.set(table.status, (byStatus.get(table.status) ?? 0) + 1);
      if (table.status === "AVAILABLE") seatsFree += table.capacity;
    }
    return { total: tables.length, byStatus, seatsFree };
  }, [tables]);

  /** Grouped by section, sections alphabetical, unsectioned last — same order as `/app/tables`. */
  const grouped = useMemo(() => {
    const buckets = new Map<string, DiningTable[]>();
    for (const table of tables) {
      const key = table.section?.trim() || UNSECTIONED;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(table);
      else buckets.set(key, [table]);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === UNSECTIONED) return 1;
      if (b === UNSECTIONED) return -1;
      return a.localeCompare(b);
    });
  }, [tables]);

  return (
    <>
      <QueryBoundary
        query={tablesQuery}
        what="the floor plan"
        isEmpty={tables.length === 0}
        loading={
          // `Skeleton`, not a hand-rolled `animate-pulse` div. The hand-rolled one was a
          // PERPETUAL animation on an `operational` surface: D-38-04 forbids it, gate G5
          // measures 0 running animations on `app/pos/**`, and the shared component already
          // encodes the rule — it reads the zone and renders a flat `--muted` block here while
          // still shimmering on the dashboard. Twelve pulsing tiles were the only thing on this
          // route that could have failed that gate during a slow load, and nothing measured it
          // because the gate samples the settled page.
          <div className="grid grid-cols-3 gap-(--space-sm) p-(--space-md) sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        }
        empty={
          // Reached ONLY when the request succeeded and genuinely returned nothing. The copy
          // now says which list is empty and what to do about it (UI-SPEC §8.3: an empty state
          // names the cause and the next action), instead of a bare "No tables configured"
          // that was equally likely to mean "the request failed" or "the session is still
          // starting up".
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-foreground-secondary">
            <span className="text-display" aria-hidden="true">
              🪑
            </span>
            <p className="text-small">
              No active tables at this branch. Add one under Tables, or restore a retired table
              there — retired tables are hidden from the order screen.
            </p>
          </div>
        }
      >
        <div className="flex h-full flex-col gap-(--space-md) overflow-y-auto p-(--space-md)">
          {/*
            Title + `·`-separated stat line — the demo's header grammar (D-38-15 "adopt").
            An <h2>, never an <h1>: `app/(tenant)/app/pos/page.tsx` owns this route's single
            sr-only <h1> and gate G12a counts exactly one.
          */}
          <div className="flex flex-wrap items-baseline gap-x-(--space-md) gap-y-1">
            <h2 className="text-label font-semibold tracking-wide uppercase text-foreground-secondary">
              Floor view
            </h2>
            <p
              data-testid="floor-stat-line"
              className="flex flex-wrap items-baseline gap-x-1.5 text-small text-foreground-secondary"
              aria-live="polite"
            >
              <span className="tabular-nums">
                {summary.total} {summary.total === 1 ? "table" : "tables"}
              </span>
              {TABLE_STATUS_ORDER.filter((status) => (summary.byStatus.get(status) ?? 0) > 0).map(
                (status) => (
                  <span key={status} className="flex items-baseline gap-x-1.5">
                    <span aria-hidden="true" className="text-foreground-tertiary">
                      ·
                    </span>
                    <span className="tabular-nums">
                      {summary.byStatus.get(status)} {TABLE_STATUS[status].label.toLowerCase()}
                    </span>
                  </span>
                ),
              )}
              <span aria-hidden="true" className="text-foreground-tertiary">
                ·
              </span>
              <span className="tabular-nums">{summary.seatsFree} seats free</span>
            </p>
          </div>

          {grouped.map(([section, sectionTables]) => (
            <section
              key={section}
              aria-label={`${section} section`}
              className="flex flex-col gap-(--space-sm)"
            >
              <div className="flex items-baseline justify-between gap-(--space-sm)">
                <h3 className="text-label font-semibold tracking-wide uppercase text-foreground-tertiary">
                  {section}
                </h3>
                <span className="text-label tabular-nums text-foreground-tertiary">
                  {sectionTables.length} {sectionTables.length === 1 ? "table" : "tables"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-(--space-sm) sm:grid-cols-4 md:grid-cols-6">
                {sectionTables.map((table) => (
                  <TableTile key={table.id} table={table} now={now} onTap={handleTap} />
                ))}
              </div>
            </section>
          ))}

          <FloorPlanScopeNote />
        </div>
      </QueryBoundary>

      <OrderTableDetailDrawer
        open={detailTable !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTable(null);
        }}
        tableId={detailTable?.id ?? null}
        tableName={detailTable?.tableName ?? null}
        onFullMenu={(target) => {
          setDetailTable(null);
          onFullMenu?.(target);
        }}
      />
    </>
  );
}

/**
 * What this floor view cannot show, named — with the reason, on the screen (D-38-16).
 *
 * <p>Brief §17 asks for eight table states, seat time, the assigned server and
 * transfer/merge/split. `pos-service` exposes three runtime states and no occupancy, seat-time or
 * server-assignment field at all (UI-SPEC §13). The alternative to saying so here is an eight-slot
 * legend where five slots never light up, which reads as "the restaurant never uses those" rather
 * than "this product cannot see them" — the precise confusion the Menu Margin Ranking taught this
 * codebase to stop shipping.
 *
 * <p>It is rendered as a quiet note at the BOTTOM rather than a banner: it is a limitation a
 * manager should be able to find, not a warning a waiter has to dismiss forty times a shift.
 */
function FloorPlanScopeNote() {
  return (
    <aside
      data-testid="floor-scope-note"
      className="mt-auto flex gap-(--space-sm) rounded-lg border border-border bg-surface-2 p-(--space-md) text-label text-foreground-secondary"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p>
          <span className="font-semibold">
            These three states are the ones this branch records.
          </span>{" "}
          Reserved and Out of service are not shown because pos-service stores neither — there is no
          reservation, and retiring a table under Tables removes it from this screen rather than
          marking it unusable.
        </p>
        <p>
          The time on an occupied tile is how long its <strong>check</strong> has been open, not how
          long the party has been seated: seat time and server assignment are not recorded.
          Drag-positioned floor plans are read-only in the data model — floor-plan coordinates come
          down null and nothing writes them — so tables are grouped by section rather than placed.
        </p>
      </div>
    </aside>
  );
}

interface TableTileProps {
  table: DiningTable;
  now: number;
  onTap: (table: DiningTable) => void;
}

/**
 * One table. **Four channels per state, and the 80px target stays** — the demo's 38px chip is
 * below WCAG 2.2 SC 2.5.5 and was not adopted.
 *
 * <p>The state is carried by border colour, tint, a distinct icon SHAPE and the literal word
 * (§4.2). Everything below the state line is real, fetched data: the derived kitchen progress,
 * the age of the open check and its running total — three things a waiter crossing the floor
 * needs, none of which this tile showed before.
 */
function TableTile({ table, now, onTap }: TableTileProps) {
  const descriptor = TABLE_STATUS[table.status];
  const Icon = descriptor.icon;

  // Derived-order-status badge for OCCUPIED tiles only (UI-SPEC §2 / POS-15 "clear
  // status indicators at a glance") — called unconditionally (hook rules), gated by an
  // empty tableId for non-OCCUPIED tiles, same pattern as the shared drawer's own
  // useTableDetail(isTableMode ? tableId : "") call.
  const detailQuery = useTableDetail(table.status === "OCCUPIED" ? table.id : "");
  const detail = table.status === "OCCUPIED" ? (detailQuery.data ?? null) : null;
  const derivedStatus = detail?.derivedStatus ?? null;
  const openedAt = detail?.activeOrder?.openedAt ?? null;
  const elapsed = openedAt ? readElapsed(openedAt, now) : null;

  return (
    <button
      type="button"
      data-testid={`table-${table.tableName.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={() => onTap(table)}
      // Zone `operational` (D-38-04): the only motion is `transition-colors` and the existing
      // 95% active press. No resting transform — `app/pos/**` carries the receipt print path,
      // and `.receipt-root` resolves its `position: fixed` against the viewport.
      className={cn(
        "touch-target flex min-h-[80px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 transition-colors active:scale-95",
        descriptor.border,
        descriptor.tint,
      )}
    >
      <span className="text-pos font-semibold">{table.tableName}</span>
      <span className="inline-flex items-center gap-1 text-label font-medium">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {descriptor.label}
      </span>
      {derivedStatus && <StatusBadge status={derivedStatus} />}
      {elapsed ? (
        <span
          className="text-label tabular-nums text-foreground-secondary"
          title={`This check has been open for ${elapsed.long}`}
        >
          <span aria-hidden="true">{elapsed.compact}</span>
          <span className="sr-only">check open {elapsed.srLabel}</span>
        </span>
      ) : null}
      {detail && detail.totalPaisa > 0 ? (
        // Money has exactly one formatting path in this product (money-display.tsx) — including
        // on a 96px tile.
        <MoneyDisplay paisa={detail.totalPaisa} className="text-label text-primary" />
      ) : null}
      <span className="text-label text-foreground-secondary">
        {table.capacity} {table.capacity === 1 ? "seat" : "seats"}
      </span>
    </button>
  );
}

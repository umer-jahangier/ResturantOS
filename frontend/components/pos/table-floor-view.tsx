"use client";

import { useState } from "react";
import { CheckCircle2, Sparkles, Utensils } from "lucide-react";
import { useTables } from "@/lib/hooks/pos/use-orders";
import { useTableDetail } from "@/lib/hooks/pos/use-tables";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
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
}

const STATE_CONFIG: Record<
  TableStatus,
  { border: string; bg: string; icon: typeof CheckCircle2; label: string }
> = {
  AVAILABLE: {
    border: "border-success",
    bg: "bg-success/10",
    icon: CheckCircle2,
    label: "Available",
  },
  OCCUPIED: { border: "border-info", bg: "bg-info/10", icon: Utensils, label: "Occupied" },
  NEEDS_BUSSING: {
    border: "border-warning",
    bg: "bg-warning/10",
    icon: Sparkles,
    label: "Needs Bussing",
  },
};

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
 * Using it here is not a style change, it is the fix.
 */
export function TableFloorView({ onTableSelect }: TableFloorViewProps) {
  const tablesQuery = useTables();
  const tables = tablesQuery.data ?? [];
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

  return (
    <>
      <QueryBoundary
        query={tablesQuery}
        what="the floor plan"
        isEmpty={tables.length === 0}
        loading={
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        }
        empty={
          // Reached ONLY when the request succeeded and genuinely returned nothing. The copy
          // now says which list is empty and what to do about it (UI-SPEC §8.3: an empty state
          // names the cause and the next action), instead of a bare "No tables configured"
          // that was equally likely to mean "the request failed" or "the session is still
          // starting up".
          <div className="flex flex-col items-center justify-center h-40 gap-2 px-4 text-center text-muted-foreground">
            <span className="text-3xl" aria-hidden="true">
              🪑
            </span>
            <p className="text-small">
              No active tables at this branch. Add one under Tables, or restore a retired table
              there — retired tables are hidden from the order screen.
            </p>
          </div>
        }
      >
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-4">
          {tables.map((table) => (
            <TableTile key={table.id} table={table} onTap={handleTap} />
          ))}
        </div>
      </QueryBoundary>

      <OrderTableDetailDrawer
        open={detailTable !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTable(null);
        }}
        tableId={detailTable?.id ?? null}
        tableName={detailTable?.tableName ?? null}
      />
    </>
  );
}

interface TableTileProps {
  table: DiningTable;
  onTap: (table: DiningTable) => void;
}

function TableTile({ table, onTap }: TableTileProps) {
  const config = STATE_CONFIG[table.status];
  const Icon = config.icon;

  // Derived-order-status badge for OCCUPIED tiles only (UI-SPEC §2 / POS-15 "clear
  // status indicators at a glance") — called unconditionally (hook rules), gated by an
  // empty tableId for non-OCCUPIED tiles, same pattern as the shared drawer's own
  // useTableDetail(isTableMode ? tableId : "") call.
  const detailQuery = useTableDetail(table.status === "OCCUPIED" ? table.id : "");
  const derivedStatus =
    table.status === "OCCUPIED" ? (detailQuery.data?.derivedStatus ?? null) : null;

  return (
    <button
      type="button"
      data-testid={`table-${table.tableName.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={() => onTap(table)}
      className={cn(
        "touch-target min-h-[80px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 p-2 transition-colors active:scale-95",
        config.border,
        config.bg,
      )}
    >
      <span className="font-semibold text-sm">{table.tableName}</span>
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {config.label}
      </span>
      {derivedStatus && <StatusBadge status={derivedStatus} className="text-[10px]" />}
      <span className="text-xs text-muted-foreground">{table.capacity} seats</span>
    </button>
  );
}

"use client";

import * as React from "react";
import type { ColumnDef, ColumnFiltersState } from "@tanstack/react-table";

import { DataGrid } from "@/components/ui/data-grid/data-grid";

/**
 * Back-compatible façade over {@link DataGrid} (38-02).
 *
 * <h3>Why this file still exists</h3>
 *
 * Four files import `DataTable` — `inventory/stock`, `inventory/ingredients`,
 * `purchasing/vendors/[id]` and `components/pos/order-management.tsx`. Deleting the name would
 * have made 38-02 a four-screen change instead of a component change, and one of those four is
 * the POS order list, which is an `operational` surface that this plan is not otherwise touching.
 *
 * So the name survives and forwards. Its callers gain the §7.2 contract for free — sticky header,
 * one row height, real pagination, `--text-small` cells — which is the point: the audit measured
 * `thead th { position: static }` and row heights of **65px and 81px inside a single table** on
 * `/app/inventory/stock`, a screen that was already using this component. The defect was never in
 * the call sites.
 *
 * <p>New screens should import `DataGrid` directly: it is the one that exposes the card fallback,
 * density, selection and the filtered-empty state, and a screen that cannot reach those is a
 * screen that will hand-roll a `<table>` again.
 */
interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  rowClassName?: (row: TData) => string | undefined;
  columnFilters?: ColumnFiltersState;
  /**
   * Forwarded to {@link DataGrid}. `columnFilters` alone already makes the grid render the
   * filtered-empty copy instead of "nothing here yet", so this is only needed for a filter the
   * grid cannot see — a server-side query, a date range, a tab.
   */
  isFiltered?: boolean;
  /** Wires the `[Clear all]` affordance on the filtered-empty state. Without it the state is a
   * description with no way out of itself. */
  onClearFilters?: () => void;
}

function DataTable<TData>({
  columns,
  data,
  isLoading = false,
  emptyMessage,
  pageSize = 25,
  rowClassName,
  columnFilters,
  isFiltered,
  onClearFilters,
}: DataTableProps<TData>) {
  return (
    <DataGrid
      columns={columns}
      data={data}
      isLoading={isLoading}
      emptyTitle={emptyMessage}
      pageSize={pageSize}
      rowClassName={rowClassName}
      columnFilters={columnFilters}
      isFiltered={isFiltered}
      onClearFilters={onClearFilters}
    />
  );
}

export { DataTable };
export type { ColumnDef };

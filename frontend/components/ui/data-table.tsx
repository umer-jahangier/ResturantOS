"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  /**
   * Optional per-row className (e.g. an opacity/transition pair for a fade-out exit
   * animation). Additive, backward-compatible — existing callers that don't pass this
   * see no behavior change. Added for POS-09 (Order Management's "non-closed order
   * never disappears abruptly — fade-out on close" requirement); no other DataTable
   * consumer exists yet in the codebase, so this is a zero-risk extension.
   */
  rowClassName?: (row: TData) => string | undefined;
  /**
   * Controlled column filters. Optional and defaulting to none, so the four existing call
   * sites behave identically (the same additive-prop contract as `rowClassName` above, and
   * the one UI-SPEC §7.4 mandates for the DataGrid: every new capability arrives behind a
   * prop that is off by default).
   *
   * <p>Exists so the row-model fix below is observable rather than latent. The filter UI
   * itself — facet chips, saved views, URL state — is UI-SPEC §10.2 step 7, not this plan.
   */
  columnFilters?: ColumnFiltersState;
}

function DataTable<TData>({
  columns,
  data,
  isLoading = false,
  emptyMessage,
  pageSize = 10,
  rowClassName,
  columnFilters,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // UI-SPEC §7.4 "Wiring bug to fix": the footer below has always called
    // `table.getFilteredRowModel()`, but this model was never registered. TanStack falls
    // back to the core row model rather than throwing, so the bug is silent: filtering
    // could never work, and "Showing 1–50 of N" would report the UNFILTERED total the
    // moment any filter existed. Registering it makes the count mean what it says.
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    initialState: { pagination: { pageSize } },
    state: { sorting, ...(columnFilters ? { columnFilters } : {}) },
  });

  if (isLoading) {
    return <DataTableSkeleton columns={columns.length} />;
  }

  if (data.length === 0) {
    return <EmptyState title={emptyMessage ?? "No data"} />;
  }

  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const from = pageIndex * currentPageSize + 1;
  const to = Math.min(from + currentPageSize - 1, totalRows);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      // UI-SPEC §9.3: a bare <th> gives a screen reader no column
                      // association, so every cell is announced without its header.
                      scope="col"
                      className={cn(
                        "h-10 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap",
                        canSort && "cursor-pointer select-none",
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-muted-foreground">
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b transition-colors hover:bg-muted/30 last:border-b-0",
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted-foreground">
          {totalRows > 0 ? `Showing ${from}–${to} of ${totalRows}` : "No results"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export { DataTable };
export type { ColumnDef };

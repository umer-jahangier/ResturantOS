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
  type Row,
  type RowData,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The one enterprise data table (UI-SPEC §7; brief §23, §19, §48, §49, §57).
 *
 * <h3>The defect this replaces</h3>
 *
 * The audit called tables "the largest structural defect in the product": **37 files hand-roll a
 * `<table>`; 4 import the shared one.** Measured live on `/app/inventory/stock` — a screen that
 * *does* use the shared component, so this is the shared component's own record:
 *
 * | property | measured | contract |
 * |---|---|---|
 * | `thead th` computed `position` | `static` on **12 of 12** tables | `sticky` |
 * | row heights inside ONE table | **65px and 81px** | one value, 32 or 44 |
 * | row-selection checkboxes | **0** anywhere | present when `bulkActions` is passed |
 * | pagination | absent — 84 rows in one ungated list | 25/50/100 with `Page N of M` |
 * | at 390px | desktop table dropped in unchanged, **100 elements past the viewport** | card list |
 *
 * <h3>Zone discipline — why this component is deliberately plain</h3>
 *
 * `DataGrid` is consumed by `restrained` **and** `operational` surfaces (UI-SPEC §5). It
 * therefore carries **no glass, no entrance animation and no hover translate**. A shared
 * component enriched for the dashboard is exactly how the POS acquires a compositing filter
 * nobody chose — the failure mode D-38-04 names.
 *
 * <h3>No virtualization, and that is a spec decision, not an omission</h3>
 *
 * Plan 38-02 called for `@tanstack/react-virtual` above 200 rows. It is **not installed**, and
 * UI-SPEC §12 fixes this phase's dependency budget at 24 with zero additions, enforced by
 * `dependency-budget.test.ts`. Pagination at 25/50/100 makes the 200-row case moot: the worst
 * list in the product is 84 rows, and it is now paged. The spec wins over the plan.
 */

/**
 * Column priority — the narrow-viewport answer *between* the full table and the card list.
 *
 * <h3>The measurement this exists for</h3>
 *
 * The card fallback below solves 390px. It does not solve **1024px**, and the audit measured that
 * separately: `/app/inventory/stock` put **42 elements past the viewport at 1024px**. At that
 * width the card list is gone (it is `md:hidden`) and the eight-column table is back — eight
 * `whitespace-nowrap` columns inside roughly 780px of content area once the sidebar is paid for.
 *
 * <p>The wrapper's `overflow-x-auto` means nothing is *clipped*: the last columns are reachable by
 * scrolling. That is why the earlier probe could report a healthy page while the screen was
 * unreadable, and it is exactly the distinction 38-14 draws — **a table that becomes a
 * horizontally-scrolling strip has not adapted, it has been shrunk.** Reachable is not adapted.
 *
 * <h3>Why hiding a column is honest here and hiding a row's value would not be</h3>
 *
 * A dropped column is a *deferred* fact, not a denied one: the same row's card view carries the
 * values that matter on a phone, and widening the window brings the column back with no state to
 * restore. Nothing is summarised, rounded or approximated — the distinction D-38-16 draws between
 * an absence and a made-up figure is untouched, because no figure is invented.
 *
 * <p>It is the caller's judgement, never the component's: `DataGrid` has no idea whether "Avg
 * cost" or "Reorder point" is the one a buyer scans for, so it declines to guess. A column with
 * no `hideBelow` is visible at every width, which keeps every existing call site unchanged.
 *
 * <p>`table-cell` rather than `block` on the restore: a `<td>` put back as `display: block` leaves
 * the table row, and the row's remaining cells silently re-flow into the wrong columns.
 */
const HIDE_BELOW = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

export type HideBelow = keyof typeof HIDE_BELOW;

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the shape of the interface
  // TanStack augments; both parameters are required by its declaration and neither is referenced.
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Drop this column below the named breakpoint. Omit it and the column is always visible.
     *
     * <p>Only the three breakpoints the audit measures at are offered — 768, 1024, 1280. There is
     * deliberately no arbitrary-pixel escape hatch: a per-column one-off breakpoint is how a
     * product ends up with the "dozens of breakpoints" brief §60 names.
     */
    hideBelow?: HideBelow;
  }
}

/** UI-SPEC §2: both on the 4-grid; 44 is the WCAG 2.2 SC 2.5.5 target size. */
const ROW_HEIGHT = {
  compact: "h-8", // 32px
  comfortable: "h-11", // 44px
} as const;

const CELL_PADDING = {
  compact: "px-3 py-0",
  comfortable: "px-4 py-0",
} as const;

export type Density = keyof typeof ROW_HEIGHT;

/**
 * How a row collapses to a card below `md`.
 *
 * <p>Required whenever the grid can be seen on a narrow viewport, which is every back-office
 * screen. Brief §57: "do not force desktop tables onto mobile." A horizontally-scrolled desktop
 * table is the thing this exists to prevent, so the shape asks for the three things a card can
 * actually show rather than letting a caller pass twelve columns and hope.
 */
export interface CardRenderers<TData> {
  /** The line a user scans for — ingredient name, PO reference, order number. */
  primary: (row: TData) => React.ReactNode;
  /** Context under it — category, vendor, table. */
  secondary?: (row: TData) => React.ReactNode;
  /** The number, right-aligned — money, quantity, status. */
  trailing?: (row: TData) => React.ReactNode;
  /** Row-level actions, rendered as a menu trigger. */
  actions?: (row: TData) => React.ReactNode;
}

export interface DataGridProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;

  /** UI-SPEC §7.2 — one value per table, never two heights in one body. */
  density?: Density;

  /** 25 / 50 / 100. The pager is hidden when a single page holds everything. */
  pageSize?: number;

  /** Empty state (query succeeded, genuinely nothing). UI-SPEC §8.3. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };

  /**
   * Whether a filter is currently narrowing the data.
   *
   * <p>UI-SPEC §8.3 makes filtered-empty a DIFFERENT state from empty, with different copy: "no
   * purchase orders match these filters" is actionable and "no purchase orders yet" is not, and
   * showing the second to someone who typed a search is the product telling them their business
   * has nothing in it.
   */
  isFiltered?: boolean;
  onClearFilters?: () => void;

  /** Below `md` the grid renders these as a card list instead of a table. */
  card?: CardRenderers<TData>;

  /** Stable row identity for selection. Required to enable the checkbox column. */
  getRowId?: (row: TData) => string;
  /** Rendered when a selection exists; `{n} selected` is shown alongside (UI-SPEC §7.4). */
  bulkActions?: (selected: TData[]) => React.ReactNode;

  rowClassName?: (row: TData) => string | undefined;
  columnFilters?: ColumnFiltersState;
  /** Accessible name for the table, announced instead of "table with N columns". */
  label?: string;
}

export function DataGrid<TData>({
  columns,
  data,
  isLoading = false,
  density = "comfortable",
  pageSize = 25,
  emptyTitle,
  emptyDescription,
  emptyAction,
  isFiltered = false,
  onClearFilters,
  card,
  getRowId,
  bulkActions,
  rowClassName,
  columnFilters,
  label,
}: DataGridProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [size, setSize] = React.useState(pageSize);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    initialState: { pagination: { pageSize: pageSize } },
    // `pagination` is deliberately NOT in `state`: putting it there makes it a CONTROLLED value,
    // and without an `onPaginationChange` handler TanStack would pin `pageIndex` at whatever was
    // passed — Next/Previous would re-render and land on page 1 forever. TanStack owns the index;
    // the page SIZE is pushed in through the effect below.
    state: { sorting, ...(columnFilters ? { columnFilters } : {}) },
  });

  React.useEffect(() => {
    table.setPageSize(size);
  }, [size, table]);

  const selectable = Boolean(getRowId && bulkActions);

  if (isLoading) return <DataTableSkeleton columns={columns.length} />;

  const totalRows = table.getFilteredRowModel().rows.length;

  /*
   * Filtered-empty is decided on the rows that SURVIVED the filter, not on the array that came in.
   *
   * <h3>The hole this closes</h3>
   *
   * The check used to be `data.length === 0`, and `columnFilters` is applied by TanStack INSIDE
   * the table — so a screen that narrows client-side (`/app/inventory/stock` and the three other
   * `DataTable` callers) handed in a full `data` array, filtered it down to nothing, and fell
   * through both branches into the table render. The result was a header, a pager reading
   * "0 of 84", and a body with no rows and no sentence in it at all: not the wrong state, the
   * absence of one. A person who typed a search saw a table that looked broken.
   *
   * <p>`isFiltered` is still the caller's word for a filter this component cannot see — a server
   * query, a date range, a tab. An active `columnFilters` is one it CAN see, and inferring it
   * means the four façade callers get the distinction without touching four screens. UI-SPEC §8.3
   * only cares that the two states are told apart; it does not care which layer noticed.
   */
  const narrowed = isFiltered || (columnFilters?.length ?? 0) > 0;

  if (totalRows === 0) {
    return narrowed ? (
      <EmptyState
        title="Nothing matches these filters."
        description="Try widening or clearing them to see more."
        /* The way OUT of the filter, never a create CTA: someone who is filtering has not asked
           to add a record, and offering one answers a question they did not ask. */
        action={onClearFilters ? { label: "Clear all", onClick: onClearFilters } : undefined}
      />
    ) : (
      <EmptyState
        title={emptyTitle ?? "Nothing here yet"}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const selectedRows = getRowId ? data.filter((r) => selected.has(getRowId(r))) : [];

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected =
    selectable && rows.length > 0 && rows.every((r) => selected.has(getRowId!(r.original)));

  return (
    <div className="flex flex-col gap-(--space-sm)">
      {selectable && selectedRows.length > 0 && (
        // UI-SPEC §7.4: the count is ALWAYS visible while a selection exists. A bulk action
        // whose scope the user cannot see is how twelve things get archived instead of one.
        <div className="flex flex-wrap items-center justify-between gap-(--space-sm) rounded-lg border bg-surface-2 px-(--space-md) py-(--space-sm)">
          <span className="text-small font-medium" data-testid="data-grid-selected-count">
            {selectedRows.length} selected
          </span>
          <div className="flex items-center gap-(--space-sm)">{bulkActions!(selectedRows)}</div>
        </div>
      )}

      {/* ── Desktop: the table. Hidden below md, where the card list takes over. ─────────── */}
      <div
        className={cn(
          "overflow-x-auto rounded-lg border",
          // The card fallback only exists if the caller supplied one. Without it, keeping the
          // table on small screens is still better than rendering nothing — but `card` is
          // strongly expected, and the e2e gate asserts 0 tables at 390px on migrated screens.
          card && "hidden md:block",
        )}
      >
        <table className="w-full caption-bottom text-small" aria-label={label}>
          {/* UI-SPEC §7.2. Measured `static` on 12 of 12 tables; scroll past row 12 on the
              84-row PO list and the column meanings were simply gone.

              Sticky lives on the `<th>`, NOT on `<thead>`. Written on `<thead>` it reads back as
              `position: static` on the cells — which is exactly what the contract and the audit
              both measure ("`thead th` computed position"), so the rule would have been present
              in the stylesheet and absent from the measurement. Browser support for a sticky
              section element is also newer and patchier than for a sticky cell. Each `<th>`
              carries its own background, because a transparent sticky cell lets rows scroll
              visibly underneath it. */}
          <thead className="border-b">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {selectable && (
                  <th
                    scope="col"
                    className={cn(
                      "sticky top-0 z-(--z-sticky) w-11 bg-surface-2",
                      CELL_PADDING[density],
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      className="size-4 rounded-sm border-input"
                      checked={allOnPageSelected}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          for (const r of rows) {
                            const id = getRowId!(r.original);
                            if (allOnPageSelected) next.delete(id);
                            else next.add(id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                )}
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const hide = header.column.columnDef.meta?.hideBelow;
                  return (
                    <th
                      key={header.id}
                      // A bare <th> gives a screen reader no column association, so every cell
                      // is announced without its header.
                      scope="col"
                      aria-sort={
                        !canSort
                          ? undefined
                          : sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                      }
                      className={cn(
                        "sticky top-0 z-(--z-sticky) bg-surface-2",
                        "h-9 text-left align-middle whitespace-nowrap",
                        // UI-SPEC §3: a column header IS the Label role.
                        "text-label uppercase tracking-[0.04em] text-foreground-secondary",
                        CELL_PADDING[density],
                        hide && HIDE_BELOW[hide],
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          // 44px hit area on a 36px header row (UI-SPEC §11: back-office rows
                          // may use a smaller box with a 44px target).
                          className="-my-1 flex h-11 w-full items-center gap-1 text-left uppercase"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ChevronUp className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronsUpDown
                              className="size-3.5 shrink-0 opacity-50"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row: Row<TData>) => {
              const id = getRowId?.(row.original);
              return (
                <tr
                  key={row.id}
                  data-selected={id && selected.has(id) ? "true" : undefined}
                  className={cn(
                    // ONE height for every row. The audit measured 65px AND 81px inside a single
                    // table body, which is what makes a long list unscannable.
                    ROW_HEIGHT[density],
                    "border-b transition-colors last:border-b-0 hover:bg-surface-2 data-[selected=true]:bg-selected",
                    rowClassName?.(row.original),
                  )}
                >
                  {selectable && (
                    <td className={cn(CELL_PADDING[density], "align-middle")}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        className="size-4 rounded-sm border-input"
                        checked={selected.has(id!)}
                        onChange={() => toggle(id!)}
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => {
                    const hide = cell.column.columnDef.meta?.hideBelow;
                    return (
                      <td
                        key={cell.id}
                        // `whitespace-nowrap` is what actually holds the row to ONE height: `h-11`
                        // on the <tr> is a MINIMUM, and a wrapping cell overrides it silently.
                        // Measured on /app/inventory/stock before this: 44px and 55px in one body.
                        // Overflow scrolls horizontally in the wrapper rather than being clipped,
                        // so nothing becomes unreadable — it becomes reachable. Reachable is not
                        // adapted, which is what `meta.hideBelow` is for; see HIDE_BELOW above.
                        className={cn(
                          CELL_PADDING[density],
                          "align-middle whitespace-nowrap",
                          hide && HIDE_BELOW[hide],
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Below md: a card list, never a horizontally-scrolled desktop table. ────────────
           Both branches are in the DOM and CSS picks one. The alternative — choosing in JS from
           a media query — renders one branch on the server and possibly the other on the client,
           which is a hydration mismatch on every list screen in the product.

           The cost is real and bounded: rows are duplicated in the DOM, so a query like
           `getByText("Chicken")` now matches twice (three stock tests were updated to scope to
           the table for exactly this reason). It is NOT an accessibility cost — `hidden` resolves
           to `display: none`, which removes the branch from the accessibility tree, so nothing is
           announced twice. And pagination bounds the duplication at the page size rather than the
           row count, which is what makes it acceptable under brief §42. */}
      {card && (
        <ul className="flex flex-col gap-(--space-sm) md:hidden" data-testid="data-grid-cards">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-(--space-md) rounded-lg border p-(--space-md)"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium">{card.primary(row.original)}</div>
                {card.secondary && (
                  <div className="truncate text-small text-foreground-secondary">
                    {card.secondary(row.original)}
                  </div>
                )}
              </div>
              {card.trailing && (
                <div className="shrink-0 text-small tabular-nums">
                  {card.trailing(row.original)}
                </div>
              )}
              {card.actions?.(row.original) ?? null}
            </li>
          ))}
        </ul>
      )}

      {/* ── The count is ALWAYS shown; the CONTROLS appear only when there is more than one
           page, so a five-row list stays quiet without going silent.

           The count is not decoration. `data-table.tsx` once called `getFilteredRowModel()`
           without registering the model, so TanStack fell back to the core model and the footer
           reported the UNFILTERED total while a narrower set was on screen. Hiding the count on
           short lists would have removed the only place that regression is observable — which is
           why the three row-model tests assert on this line. */}
      <div className="flex flex-wrap items-center justify-between gap-(--space-sm) px-1">
        <p className="text-small text-foreground-secondary" data-testid="data-grid-count">
          {pageCount > 1 ? `Page ${pageIndex + 1} of ${pageCount} · ` : ""}
          {totalRows} row{totalRows === 1 ? "" : "s"}
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-(--space-sm)">
            <label className="flex items-center gap-(--space-xs) text-small text-foreground-secondary">
              <span>Rows</span>
              <select
                aria-label="Rows per page"
                className="h-11 rounded-md border border-input bg-transparent px-2 text-small"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export type { ColumnDef };
export { MoreHorizontal };

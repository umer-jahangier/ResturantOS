"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, Wallet, XCircle } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useCategories, useStockLevels } from "@/lib/hooks/inventory/use-inventory";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import type { StockLevel } from "@/lib/adapters/inventory.adapter";
import { OpeningBalanceDialog } from "@/components/inventory/OpeningBalanceDialog";
import { StockReceiptDialog } from "@/components/inventory/StockReceiptDialog";
import { StockTransferDialog } from "@/components/inventory/StockTransferDialog";
import { StockCountDialog } from "@/components/inventory/StockCountDialog";
import {
  FlaggedValue,
  OnHandQuantity,
  StockAlertChip,
  stockAlertLevel,
  stockRowClassName,
} from "@/components/inventory/stock-signals";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";

const EMPTY_TITLE = "No stock recorded yet";
const EMPTY_BODY =
  "Record an opening balance to start tracking on-hand quantities for this branch.";

/** The most recent count across the rendered rows — the demo subtitle's freshness part. */
function lastCountedLabel(rows: StockLevel[]): string | null {
  const stamps = rows
    .map((r) => (r.lastCountedAt ? new Date(r.lastCountedAt).getTime() : Number.NaN))
    .filter((t) => Number.isFinite(t));
  // D-38-16: never "Last count: —". A freshness fact we cannot compute is an absence, so the
  // whole clause drops out of the subtitle rather than rendering a placeholder that reads as
  // "counted, but we lost the date".
  if (stamps.length === 0) return null;
  return `Last count: ${new Date(Math.max(...stamps)).toLocaleDateString()}`;
}

// URL: /app/inventory/stock — INV-15 item 8: on-hand stock per branch (a real read endpoint,
// plan 08.2-02) plus entry points to the four write operations (opening balance/receipt/transfer/
// count) that existed API-only since Phase 8. Section tabs are owned by inventory/layout.tsx
// (08.2-14) and are not touched here.
export default function StockPage() {
  const { branchId } = useCurrentUser();
  const { data: branches } = useMyBranches();
  const categoriesQuery = useCategories();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);

  const stockQuery = useStockLevels(debouncedSearch.trim() || undefined);
  const { data, isLoading, isError } = stockQuery;

  const branchName = (branches ?? []).find((b) => b.id === branchId)?.name ?? "this branch";
  const activeCategories = (categoriesQuery.data ?? []).filter((c) => c.archivedAt == null);

  const allRows = useMemo(() => data?.items ?? [], [data]);
  const rows = useMemo(
    () => (categoryFilter ? allRows.filter((r) => r.categoryId === categoryFilter) : allRows),
    [allRows, categoryFilter],
  );

  const isFiltered = Boolean(categoryFilter) || debouncedSearch.trim() !== "";

  // Every headline number below is derived from `rows` — the exact array handed to `DataGrid`
  // one screen further down. A subtitle that disagrees with its own table is worse than none, so
  // there is deliberately no second source: not the server's item count, not an unfiltered total.
  const lowCount = rows.filter((r) => stockAlertLevel(r) === "low").length;
  const outCount = rows.filter((r) => stockAlertLevel(r) === "out").length;
  const alertCount = lowCount + outCount;

  // The branch total is the server's own figure and is only true of the WHOLE branch. Under a
  // filter it would silently describe rows that are not on screen, so the filtered case sums the
  // rendered rows instead and says so in the label. Integer paisa throughout; no second money path.
  const shownValuePaisa = isFiltered
    ? rows.reduce((sum, r) => sum + r.stockValuePaisa, 0)
    : (data?.totalStockValuePaisa ?? 0);

  const columns: ColumnDef<StockLevel, unknown>[] = [
    {
      accessorKey: "ingredientName",
      header: "Ingredient",
      cell: ({ row }) => (
        <div>
          <div>{row.original.ingredientName}</div>
          {row.original.sku ? (
            <div className="text-small text-muted-foreground">{row.original.sku}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "categoryName",
      header: "Category",
      cell: ({ row }) => row.original.categoryName ?? "—",
    },
    {
      accessorKey: "qtyOnHand",
      header: "On hand",
      // Task 4. A negative on-hand never renders as an ordinary number — see `stock-signals.tsx`.
      cell: ({ row }) => (
        <OnHandQuantity
          qty={row.original.qtyOnHand}
          uom={row.original.baseUomCode}
          name={row.original.ingredientName}
        />
      ),
    },
    {
      accessorKey: "reorderPoint",
      header: "Reorder point",
    },
    {
      accessorKey: "avgCostPaisa",
      header: "Avg cost",
      // A rate per stock unit, not an amount: an ingredient held in grams costs a fraction of a
      // paisa each, and two decimal places would round every one of them to Rs 0.00.
      cell: ({ row }) => <MoneyDisplay paisa={row.original.avgCostPaisa} maxFractionDigits={4} />,
    },
    {
      accessorKey: "stockValuePaisa",
      header: "Stock value",
      cell: ({ row }) => (
        <FlaggedValue
          paisa={row.original.stockValuePaisa}
          label={`${row.original.ingredientName} stock value`}
        >
          <MoneyDisplay paisa={row.original.stockValuePaisa} />
        </FlaggedValue>
      ),
    },
    {
      accessorKey: "lastCountedAt",
      header: "Last counted",
      cell: ({ row }) =>
        row.original.lastCountedAt
          ? new Date(row.original.lastCountedAt).toLocaleDateString()
          : "Never",
    },
    {
      id: "risk",
      header: "Status",
      cell: ({ row }) => <StockAlertChip level={stockAlertLevel(row.original)} />,
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Stock"
        description={`On-hand quantities and value at ${branchName}.`}
        meta={statLine(
          filteredCountLine(rows.length, allRows.length, "ingredient"),
          alertCount > 0 ? countLine(alertCount, "alert") : null,
          lastCountedLabel(rows),
        )}
        actions={
          <PermissionGuard require="inventory.item.manage">
            <div className="flex flex-wrap gap-(--space-sm)">
              <Button type="button" variant="outline" onClick={() => setOpeningBalanceOpen(true)}>
                Opening balance
              </Button>
              <StockReceiptDialog
                trigger={
                  <Button type="button" variant="outline">
                    Receipt
                  </Button>
                }
              />
              <StockTransferDialog
                trigger={
                  <Button type="button" variant="outline">
                    Transfer
                  </Button>
                }
              />
              <StockCountDialog trigger={<Button type="button">Count</Button>} />
            </div>
          </PermissionGuard>
        }
      />

      {/* The demo's 4-up KPI row (§4 Inventory), on this product's own numbers. Each tile counts
          the same `rows` the grid renders, so the row cannot contradict the table under it. */}
      <div className="grid gap-(--space-md) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={isFiltered ? "Ingredients shown" : "Ingredients tracked"}
          value={rows.length.toLocaleString()}
          icon={Boxes}
          accent="primary"
        />
        <StatTile
          label="Below reorder point"
          value={lowCount.toLocaleString()}
          icon={AlertTriangle}
          higherIsBetter={false}
        />
        <StatTile
          label="Out of stock"
          value={outCount.toLocaleString()}
          icon={XCircle}
          higherIsBetter={false}
        />
        <StatTile
          label={isFiltered ? "Stock value shown" : "Total stock value"}
          value={
            <FlaggedValue paisa={shownValuePaisa} label="total stock value">
              <MoneyDisplay paisa={shownValuePaisa} />
            </FlaggedValue>
          }
          icon={Wallet}
          accent="secondary"
        />
      </div>

      <FilterBar
        title="Stock levels"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search stock",
          placeholder: "Search by name or SKU…",
        }}
        filters={[
          {
            id: "category",
            label: "Category",
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: activeCategories.map((c) => ({ value: c.id, label: c.name })),
            isLoading: categoriesQuery.isLoading,
            error: categoriesQuery.isError,
            onRetry: () => void categoriesQuery.refetch(),
          },
        ]}
      />

      {/* 14b: this screen already refused to fake an empty state on failure — it was one of the
          four of fifteen that got GA-001 right. What it lacked was `role="alert"` (so a screen
          reader was never told) and a retry (so the only way out was a reload). Routed through the
          shared notice for both. */}
      {isError ? (
        <QueryErrorNotice
          what="stock levels"
          error={stockQuery.error}
          onRetry={() => void stockQuery.refetch()}
        />
      ) : isLoading ? (
        <DataGrid columns={columns} data={[]} isLoading />
      ) : allRows.length === 0 ? (
        <PermissionGuard
          require="inventory.item.manage"
          fallback={<EmptyState title={EMPTY_TITLE} description={EMPTY_BODY} />}
        >
          <EmptyState
            title={EMPTY_TITLE}
            description={EMPTY_BODY}
            action={{ label: "Record opening balance", onClick: () => setOpeningBalanceOpen(true) }}
          />
        </PermissionGuard>
      ) : (
        <DataGrid
          label="Stock levels"
          columns={columns}
          data={rows}
          rowClassName={stockRowClassName}
          density="comfortable"
          isFiltered={isFiltered}
          onClearFilters={() => {
            setCategoryFilter("");
            setSearch("");
          }}
          card={{
            primary: (r) => r.ingredientName,
            secondary: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {r.categoryName ?? "Uncategorised"}
                <span aria-hidden="true">·</span>
                <OnHandQuantity qty={r.qtyOnHand} uom={r.baseUomCode} name={r.ingredientName} />
              </span>
            ),
            trailing: (r) => (
              <FlaggedValue paisa={r.stockValuePaisa} label={`${r.ingredientName} stock value`}>
                <MoneyDisplay paisa={r.stockValuePaisa} />
              </FlaggedValue>
            ),
          }}
        />
      )}

      <OpeningBalanceDialog open={openingBalanceOpen} onOpenChange={setOpeningBalanceOpen} />
    </PageBody>
  );
}

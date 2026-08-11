"use client";

import { useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useCategories, useStockLevels } from "@/lib/hooks/inventory/use-inventory";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import type { StockLevel } from "@/lib/adapters/inventory.adapter";
import { OpeningBalanceDialog } from "@/components/inventory/OpeningBalanceDialog";
import { StockReceiptDialog } from "@/components/inventory/StockReceiptDialog";
import { StockTransferDialog } from "@/components/inventory/StockTransferDialog";
import { StockCountDialog } from "@/components/inventory/StockCountDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-small focus-visible:border-ring";

const EMPTY_TITLE = "No stock recorded yet";
const EMPTY_BODY =
  "Record an opening balance to start tracking on-hand quantities for this branch.";

/**
 * Row wash — reads the server-decided `belowReorderPoint`/`nonPositive` flags only; `qtyOnHand`
 * is never compared against `reorderPoint` in the browser (T-08.2-173, this phase's own origin
 * bug was exactly this class of frontend/backend divergence). Destructive wins when both flags
 * are set, mirroring `CustomerAccountRow`'s over-limit pattern (house-accounts/page.tsx:20-24).
 */
function rowClassName(row: StockLevel): string | undefined {
  return cn(row.belowReorderPoint && "bg-warning/10", row.nonPositive && "bg-destructive/10");
}

/** Colour is never the sole signal (T-08.2-175) — every washed row also gets an icon + a text
 * label via StatusBadge (the legacy warning/error variants render label-only, so the icon is
 * composed alongside rather than forking status-badge.tsx, which this plan does not own). */
function RiskChip({ row }: { row: StockLevel }) {
  if (row.nonPositive) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <XCircle className="size-3.5" aria-hidden="true" />
        <StatusBadge status="error" label="Out of stock" />
      </span>
    );
  }
  if (row.belowReorderPoint) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        <StatusBadge status="warning" label="Below reorder point" />
      </span>
    );
  }
  return <span className="text-small text-muted-foreground">—</span>;
}

// URL: /app/inventory/stock — INV-15 item 8: on-hand stock per branch (a real read endpoint,
// plan 08.2-02) plus entry points to the four write operations (opening balance/receipt/transfer/
// count) that existed API-only since Phase 8. Section tabs are owned by inventory/layout.tsx
// (08.2-14) and are not touched here.
export default function StockPage() {
  const { branchId } = useCurrentUser();
  const { data: branches } = useMyBranches();
  const { data: categories } = useCategories();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);

  const stockQuery = useStockLevels(debouncedSearch.trim() || undefined);
  const { data, isLoading, isError } = stockQuery;

  const branchName = (branches ?? []).find((b) => b.id === branchId)?.name ?? "this branch";
  const activeCategories = (categories ?? []).filter((c) => c.archivedAt == null);

  const allRows = data?.items ?? [];
  const rows = categoryFilter ? allRows.filter((r) => r.categoryId === categoryFilter) : allRows;

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
      cell: ({ row }) => `${row.original.qtyOnHand} ${row.original.baseUomCode}`,
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
      cell: ({ row }) => <MoneyDisplay paisa={row.original.stockValuePaisa} />,
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
      cell: ({ row }) => <RiskChip row={row.original} />,
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Stock"
        description={`On-hand quantities and value at ${branchName}.`}
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder="Search by name or SKU…"
            aria-label="Search stock"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          aria-label="Filter by category"
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {activeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

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
      ) : rows.length === 0 ? (
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
        <>
          <p className="text-small text-muted-foreground">
            Total stock value: <MoneyDisplay paisa={data?.totalStockValuePaisa ?? 0} />
          </p>
          <DataGrid
            label="Stock levels"
            columns={columns}
            data={rows}
            rowClassName={rowClassName}
            density="comfortable"
            isFiltered={Boolean(categoryFilter) || debouncedSearch.trim() !== ""}
            onClearFilters={() => {
              setCategoryFilter("");
              setSearch("");
            }}
            card={{
              primary: (r) => r.ingredientName,
              secondary: (r) =>
                `${r.categoryName ?? "Uncategorised"} · ${r.qtyOnHand} ${r.baseUomCode}`,
              trailing: (r) => <MoneyDisplay paisa={r.stockValuePaisa} />,
            }}
          />
        </>
      )}

      <OpeningBalanceDialog open={openingBalanceOpen} onOpenChange={setOpeningBalanceOpen} />
    </PageBody>
  );
}

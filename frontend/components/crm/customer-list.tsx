"use client";

import { useMemo, useState } from "react";
import { Gift, Sparkles, UserRound, UserRoundX } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatNumber } from "@/lib/format/locale";
import { useCustomerSearch } from "@/lib/hooks/crm/use-customers";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { Customer, LoyaltyTier } from "@/lib/models/crm.model";
import { cn } from "@/lib/utils";

/** Reuses the label-only legacy variants — a loyalty tier is not a workflow state. */
function tierStatus(tier: LoyaltyTier) {
  if (tier === "GOLD") return "warning" as const;
  if (tier === "SILVER") return "active" as const;
  return "inactive" as const;
}

/**
 * The customer directory (38-08 task 5).
 *
 * <h3>Why this became a grid</h3>
 *
 * It was a `<ul className="divide-y">` of buttons, which is the shape the audit calls out as the
 * half of the back office a "migrate the tables" plan silently skips: it is tabular data — name,
 * phone, tier, points, lifetime spend — laid out as a list, so nothing sorts, nothing paginates,
 * and the columns have no headers to be announced with each cell. The row still selects, and the
 * selection still drives the detail panel beside it; the row is now a real control inside a real
 * table cell rather than a `<button>` wearing a list item.
 *
 * <h3>The avatar is decoration and says so</h3>
 *
 * `Avatar` is rendered without a `label`, which marks it `aria-hidden`. The person's name is in
 * the cell beside it, and a labelled avatar would have every row announced twice.
 */
export function CustomerList({
  onSelect,
  selectedId,
}: {
  onSelect?: (customer: Customer) => void;
  selectedId?: string | null;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  // GA-001: `isError` was never read, so a crm-service outage rendered "No customers found" —
  // and, worse, the search-scoped copy "Nothing matches …", which blames the user's query for a
  // server failure and invites them to keep retyping.
  const search = useCustomerSearch(debounced);
  const customers = search.data ?? [];

  const columns = useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Customer",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onSelect?.(row.original)}
            aria-current={selectedId === row.original.id ? "true" : undefined}
            className="flex items-center gap-(--space-sm) text-left"
          >
            <Avatar name={row.original.name} toneKey={row.original.id} size="sm" />
            <span className="font-medium underline-offset-2 hover:underline">
              {row.original.name}
            </span>
          </button>
        ),
      },
      {
        id: "phone",
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => (
          // A phone number is how this product identifies a customer — it is the search key and
          // the account key — so it takes the identifier face.
          <span className="font-mono tabular-nums text-foreground-secondary">
            {row.original.phone}
          </span>
        ),
      },
      {
        id: "tier",
        accessorKey: "tier",
        header: "Tier",
        cell: ({ row }) =>
          row.original.tier ? (
            <StatusBadge status={tierStatus(row.original.tier)} label={row.original.tier} />
          ) : (
            // Not "BRONZE". A customer with no loyalty account has not been enrolled, which is a
            // different fact from being on the lowest tier — and the one the server states.
            <span className="text-foreground-tertiary">Not enrolled</span>
          ),
      },
      {
        id: "points",
        accessorKey: "pointsBalance",
        header: "Points",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{row.original.pointsBalance}</span>
        ),
      },
      {
        id: "lifetimeSpend",
        accessorKey: "lifetimeSpendPaisa",
        header: "Lifetime spend",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.lifetimeSpendPaisa} />
          </span>
        ),
      },
    ],
    [onSelect, selectedId],
  );

  /*
   * Computed off `customers` — the EXACT array the grid beneath renders — so the strip and the
   * table can never disagree. `CrmRepository.searchCustomers` caps at 20 and the response carries
   * no total, so a tenant-wide "Customers: N" is a figure this screen does not have; every label
   * here names the listed set instead of implying the roster (D-38-16).
   */
  const enrolled = customers.filter((c) => c.tier !== null).length;
  const points = customers.reduce((sum, c) => sum + c.pointsBalance, 0);
  const showStats = customers.length > 0;

  return (
    <div className="space-y-(--space-md)">
      {showStats && (
        <div
          data-testid="crm-stat-row"
          className="grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4"
        >
          <StatTile
            label="Customers listed"
            value={formatNumber(customers.length)}
            icon={UserRound}
            accent="primary"
          />
          <StatTile
            label="Enrolled in loyalty"
            value={formatNumber(enrolled)}
            icon={Sparkles}
            accent="secondary"
          />
          <StatTile
            label="Not enrolled"
            value={formatNumber(customers.length - enrolled)}
            icon={UserRoundX}
          />
          <StatTile label="Points these customers hold" value={formatNumber(points)} icon={Gift} />
        </div>
      )}

      <FilterBar
        title="Customers"
        search={{
          value: term,
          onChange: setTerm,
          label: "Search customers by phone or name",
          placeholder: "Search by phone or name…",
        }}
      />

      <QueryBoundary
        query={search}
        what="customers"
        isEmpty={customers.length === 0}
        loading={
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={
          <EmptyState
            title={debounced ? "No customers match that search" : "No customers found"}
            description={
              debounced
                ? `Nothing matches "${debounced}". Try a different phone or name.`
                : "Add your first customer to start tracking loyalty."
            }
            /* The way OUT of the filter, not a create CTA: someone searching for a regular does
               not want to add a second record for them. */
            {...(debounced ? { action: { label: "Clear all", onClick: () => setTerm("") } } : {})}
          />
        }
      >
        <DataGrid
          label="Customers"
          columns={columns}
          data={customers}
          isFiltered={debounced.trim().length > 0}
          onClearFilters={() => setTerm("")}
          rowClassName={(c) => cn(selectedId === c.id && "bg-selected")}
          emptyTitle="No customers found"
          emptyDescription="Add your first customer to start tracking loyalty."
          card={{
            primary: (c) => c.name,
            secondary: (c) => c.phone,
            trailing: (c) => <MoneyDisplay paisa={c.lifetimeSpendPaisa} />,
          }}
        />
      </QueryBoundary>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleSlash, CalendarClock, UtensilsCrossed } from "lucide-react";

import { useCoverage } from "@/lib/hooks/inventory/use-inventory";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
import type { CoverageState } from "@/lib/adapters/inventory.adapter";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

type CoverageRow = {
  menuItemId: string;
  name: string;
  state: CoverageState;
  scheduledFrom?: string | null;
};

const STATE_OPTIONS = [
  { value: "COVERED", label: "Covered" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "NO_RECIPE", label: "No recipe" },
] as const;

// URL: /app/inventory/coverage — INV-15's three-state recipe-coverage report (Covered/
// Scheduled/No recipe). Every row renders the server's own `items[].state` verbatim; this page
// never re-derives coverage from a recipe's own `current` boolean (T-08.2-162) — that exact
// frontend/backend definition mismatch (the MSW mock once keyed off the recipe's `current`
// boolean while the backend used `effective_from <= now()`) is this phase's own origin bug.
export default function CoveragePage() {
  const coverageQuery = useCoverage();
  const { data: coverage, isLoading } = coverageQuery;
  // A coverage report is a worklist, so it opens on the gaps. The control is a real filter now
  // rather than a lone "Show all" button, which is why it lives in the strip with everything else.
  const [stateFilter, setStateFilter] = useState<string>("gaps");

  const allItems = useMemo(() => (coverage?.items ?? []) as CoverageRow[], [coverage]);
  const rows = useMemo(() => {
    if (stateFilter === "gaps") return allItems.filter((item) => item.state !== "COVERED");
    if (stateFilter === "") return allItems;
    return allItems.filter((item) => item.state === stateFilter);
  }, [allItems, stateFilter]);

  // Derived from `allItems` — the array `rows` is filtered out of — so the tiles, the subtitle
  // and the grid are three views of one list rather than three independent claims.
  const covered = allItems.filter((i) => i.state === "COVERED").length;
  const scheduled = allItems.filter((i) => i.state === "SCHEDULED").length;
  const noRecipe = allItems.filter((i) => i.state === "NO_RECIPE").length;

  const columns: ColumnDef<CoverageRow, unknown>[] = [
    { accessorKey: "name", header: "Menu item" },
    {
      accessorKey: "state",
      header: "Coverage",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.state}
          label={
            row.original.state === "SCHEDULED" && row.original.scheduledFrom
              ? `Scheduled from ${new Date(row.original.scheduledFrom).toLocaleDateString()}`
              : undefined
          }
        />
      ),
    },
  ];

  // GA-001, the "eternal spinner" variant: `isLoading || !coverage` also matched the ERROR case,
  // because a failed query has no data. The screen then said "Loading coverage…" forever — a
  // failure disguised as patience, which is the same lie in a different tense.
  if (coverageQuery.isError) {
    return (
      <PageBody className="space-y-(--space-lg)">
        <PageHeader title="Recipe coverage" />
        <QueryErrorNotice
          what="recipe coverage"
          error={coverageQuery.error}
          onRetry={() => void coverageQuery.refetch()}
        />
      </PageBody>
    );
  }

  if (isLoading || !coverage) {
    return (
      <PageBody className="space-y-(--space-lg)">
        <PageHeader title="Recipe coverage" />
        <div className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </PageBody>
    );
  }

  const allCovered = noRecipe === 0 && scheduled === 0;

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Recipe coverage"
        description="Which active menu items currently resolve an effective recipe — covered, scheduled for a future date, or with no recipe at all."
        meta={statLine(
          countLine(allItems.length, "active menu item"),
          noRecipe > 0 ? `${noRecipe} with no recipe` : null,
          scheduled > 0 ? `${scheduled} scheduled` : null,
        )}
      />

      <div className="grid gap-(--space-md) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active menu items"
          value={formatNumber(allItems.length)}
          icon={UtensilsCrossed}
          accent="primary"
        />
        <StatTile label="Covered" value={formatNumber(covered)} icon={CircleCheck} />
        <StatTile label="Scheduled" value={formatNumber(scheduled)} icon={CalendarClock} />
        <StatTile label="No recipe" value={formatNumber(noRecipe)} icon={CircleSlash} />
      </div>

      {allCovered ? (
        <EmptyState title="Every active menu item has a recipe" />
      ) : (
        <>
          <FilterBar
            title="Coverage"
            filters={[
              {
                id: "state",
                label: "Coverage",
                value: stateFilter,
                onChange: setStateFilter,
                // "Gaps only" is the default and it IS a filter, so it appears as a real option
                // beside the states rather than hiding behind the strip's "all" entry.
                options: [{ value: "gaps", label: "Needs attention" }, ...STATE_OPTIONS],
                allLabel: "Every menu item",
              },
            ]}
          />

          <p className="text-small text-muted-foreground">
            {stateFilter === "gaps"
              ? `Showing ${filteredCountLine(rows.length, allItems.length, "menu item")} that still need attention — a coverage report is a worklist.`
              : `Showing ${filteredCountLine(rows.length, allItems.length, "menu item")}.`}
          </p>

          <DataGrid
            label="Recipe coverage"
            columns={columns}
            data={rows}
            density="comfortable"
            isFiltered={stateFilter !== ""}
            onClearFilters={() => setStateFilter("")}
            card={{
              primary: (row) => row.name,
              trailing: (row) => <StatusBadge status={row.state} />,
            }}
          />
        </>
      )}
    </PageBody>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  useCoverage,
  useMenuItemCatalog,
  useRecipeVersions,
} from "@/lib/hooks/inventory/use-inventory";
import { filteredCountLine, statLine } from "@/lib/format/stat-line";
import type { CoverageState, MenuItemCatalogEntry } from "@/lib/adapters/inventory.adapter";
import { RecipeFormDialog } from "@/components/inventory/RecipeFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";

const COVERAGE_OPTIONS = [
  { value: "COVERED", label: "Covered" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "NO_RECIPE", label: "No recipe" },
] as const;

/**
 * Per-row version count.
 *
 * <p>Still a component rather than an inline cell renderer, because it owns a query: the coverage
 * report gives state, not a count, and there is no bulk "recipes for every menu item" endpoint,
 * so each row scopes its own cached query exactly like the detail page does for a single menu
 * item. Under `DataGrid` this now costs one request per VISIBLE row rather than one per menu item
 * in the catalogue — pagination made the per-row query affordable.
 */
function RecipeVersionCount({ menuItemId }: { menuItemId: string }) {
  const { data: versions, isLoading } = useRecipeVersions(menuItemId);
  if (isLoading) return <span className="text-muted-foreground">…</span>;
  // Zero versions and "we could not read them" are different facts and read differently.
  if (!versions) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{versions.length}</span>;
}

// URL: /app/inventory/recipes — an index over every synced menu item: its coverage chip and
// version count, each row linking into the detail + revision-authoring page at
// recipes/{menuItemId} (INV-15). Revision authoring itself no longer happens here — it moved to
// the routed detail page's two-column live-cost view (UI-SPEC's Modal-vs-Full-Page decision).
export default function RecipesIndexPage() {
  // GA-001: neither query's error was read. A failed catalog read rendered "No menu items yet —
  // sync a menu item from POS", which is a false instruction: the items are already synced, the
  // request failed. Both queries feed this screen, so both are passed to the boundary.
  const menuItemsQuery = useMenuItemCatalog();
  const coverageQuery = useCoverage();
  const [search, setSearch] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("");
  // Seeds the "New recipe version" dialog. Not a filter — it narrows nothing — so it lives in
  // the strip's `children` slot and is deliberately absent from the active-filter count.
  const [selectedMenuItemId, setSelectedMenuItemId] = useState("");

  const coverageByMenuItemId = useMemo(
    () =>
      new Map(
        (coverageQuery.data?.items ?? []).map((item) => [item.menuItemId, item.state] as const),
      ),
    [coverageQuery.data],
  );

  const activeMenuItems = useMemo(
    () => (menuItemsQuery.data ?? []).filter((mi) => mi.active),
    [menuItemsQuery.data],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return activeMenuItems.filter((mi) => {
      if (coverageFilter && coverageByMenuItemId.get(mi.menuItemId) !== coverageFilter)
        return false;
      return needle === "" || mi.name.toLowerCase().includes(needle);
    });
  }, [activeMenuItems, coverageByMenuItemId, coverageFilter, search]);

  const isFiltered = search.trim() !== "" || coverageFilter !== "";
  const withoutRecipe = activeMenuItems.filter(
    (mi) => coverageByMenuItemId.get(mi.menuItemId) === "NO_RECIPE",
  ).length;

  const columns: ColumnDef<MenuItemCatalogEntry, unknown>[] = [
    {
      accessorKey: "name",
      header: "Menu item",
      cell: ({ row }) => (
        <Link
          href={`/app/inventory/recipes/${row.original.menuItemId}`}
          className="font-medium text-primary hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: ({ row }) => {
        const state: CoverageState | undefined = coverageByMenuItemId.get(row.original.menuItemId);
        return state ? <StatusBadge status={state} /> : "—";
      },
    },
    {
      id: "versions",
      header: "Versions",
      cell: ({ row }) => <RecipeVersionCount menuItemId={row.original.menuItemId} />,
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Recipes"
        description="Pick a menu item to view its recipe history, author a revision, and see the live plate cost."
        meta={statLine(
          filteredCountLine(rows.length, activeMenuItems.length, "menu item"),
          withoutRecipe > 0 ? `${withoutRecipe} with no recipe` : null,
        )}
        actions={
          <PermissionGuard require="inventory.item.manage">
            <RecipeFormDialog
              defaultMenuItemId={selectedMenuItemId || undefined}
              trigger={<Button>New recipe version</Button>}
            />
          </PermissionGuard>
        }
      />

      <FilterBar
        title="Menu items"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search menu items",
          placeholder: "Search by name…",
        }}
        filters={[
          {
            id: "coverage",
            label: "Coverage",
            value: coverageFilter,
            onChange: setCoverageFilter,
            options: COVERAGE_OPTIONS,
            isLoading: coverageQuery.isLoading,
            error: coverageQuery.isError,
            onRetry: () => void coverageQuery.refetch(),
          },
        ]}
      >
        <div className="flex min-w-40 flex-col gap-1">
          <label
            htmlFor="recipe-seed-menu-item"
            className="text-label font-semibold tracking-wide uppercase text-foreground-tertiary"
          >
            New revision for
          </label>
          <Select
            id="recipe-seed-menu-item"
            value={selectedMenuItemId}
            onValueChange={setSelectedMenuItemId}
            options={activeMenuItems.map((mi) => ({ value: mi.menuItemId, label: mi.name }))}
            placeholder="Select a menu item…"
            isLoading={menuItemsQuery.isLoading}
            error={menuItemsQuery.isError}
            onRetry={() => void menuItemsQuery.refetch()}
          />
        </div>
      </FilterBar>

      <QueryBoundary
        query={[menuItemsQuery, coverageQuery]}
        what="the recipe catalog"
        isEmpty={activeMenuItems.length === 0}
        empty={
          <EmptyState
            title="No menu items yet"
            description="Sync a menu item from POS before you can build its recipe."
          />
        }
      >
        <DataGrid
          label="Recipes by menu item"
          columns={columns}
          data={rows}
          density="comfortable"
          isFiltered={isFiltered}
          onClearFilters={() => {
            setSearch("");
            setCoverageFilter("");
          }}
          card={{
            primary: (mi) => (
              <Link
                href={`/app/inventory/recipes/${mi.menuItemId}`}
                className="text-primary hover:underline"
              >
                {mi.name}
              </Link>
            ),
            trailing: (mi) => {
              const state = coverageByMenuItemId.get(mi.menuItemId);
              return state ? <StatusBadge status={state} /> : "—";
            },
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}

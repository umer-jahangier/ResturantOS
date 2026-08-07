"use client";

import { useState } from "react";
import Link from "next/link";

import {
  useCoverage,
  useMenuItemCatalog,
  useRecipeVersions,
} from "@/lib/hooks/inventory/use-inventory";
import type { CoverageState, MenuItemCatalogEntry } from "@/lib/adapters/inventory.adapter";
import { RecipeFormDialog } from "@/components/inventory/RecipeFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";

function MenuItemRecipeRow({
  menuItem,
  coverageState,
}: {
  menuItem: MenuItemCatalogEntry;
  coverageState: CoverageState | undefined;
}) {
  // Per-row version count — the coverage report gives state, not a count, and there is no bulk
  // "recipes for every menu item" endpoint, so each row scopes its own cached query exactly like
  // the detail page does for a single menu item.
  const { data: versions } = useRecipeVersions(menuItem.menuItemId);

  return (
    <tr className="border-b">
      <td className="py-2 pr-4">
        <Link
          href={`/app/inventory/recipes/${menuItem.menuItemId}`}
          className="text-primary hover:underline"
        >
          {menuItem.name}
        </Link>
      </td>
      <td className="py-2 pr-4">{coverageState ? <StatusBadge status={coverageState} /> : "—"}</td>
      <td className="py-2 pr-4">{versions?.length ?? "—"}</td>
    </tr>
  );
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
  const [selectedMenuItemId, setSelectedMenuItemId] = useState("");

  const coverageByMenuItemId = new Map(
    (coverageQuery.data?.items ?? []).map((item) => [item.menuItemId, item.state] as const),
  );

  const activeMenuItems = (menuItemsQuery.data ?? []).filter((mi) => mi.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Recipes</h1>
          <p className="text-sm text-muted-foreground">
            Pick a menu item to view its recipe history, author a revision, and see the live plate
            cost.
          </p>
        </div>
        <PermissionGuard require="inventory.item.manage">
          <RecipeFormDialog
            defaultMenuItemId={selectedMenuItemId || undefined}
            trigger={<Button>New recipe version</Button>}
          />
        </PermissionGuard>
      </div>

      <div className="max-w-sm">
        <select
          aria-label="Menu item"
          value={selectedMenuItemId}
          onChange={(e) => setSelectedMenuItemId(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring"
        >
          <option value="">Select a menu item…</option>
          {activeMenuItems.map((mi) => (
            <option key={mi.menuItemId} value={mi.menuItemId}>
              {mi.name}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        Revision authoring now lives on each recipe&apos;s detail page — open a menu item below to
        view its version history and author a new revision.
      </p>

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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Menu item</th>
              <th className="py-2 pr-4">Coverage</th>
              <th className="py-2 pr-4">Versions</th>
            </tr>
          </thead>
          <tbody>
            {activeMenuItems.map((mi) => (
              <MenuItemRecipeRow
                key={mi.menuItemId}
                menuItem={mi}
                coverageState={coverageByMenuItemId.get(mi.menuItemId)}
              />
            ))}
          </tbody>
        </table>
      </QueryBoundary>
    </div>
  );
}

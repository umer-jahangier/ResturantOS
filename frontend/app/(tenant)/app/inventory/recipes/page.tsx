"use client";

import { useState } from "react";
import { useMenuItemCatalog, useRecipeVersions } from "@/lib/hooks/inventory/use-inventory";
import { RecipeFormDialog } from "@/components/inventory/RecipeFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// URL: /app/inventory/recipes — pick a real synced menu item, see its existing recipe versions,
// and author a new one (INV-10, D-04 vertical slice).
export default function RecipeBuilderPage() {
  const { data: menuItems } = useMenuItemCatalog();
  const [selectedMenuItemId, setSelectedMenuItemId] = useState("");
  const { data: versions, isLoading } = useRecipeVersions(selectedMenuItemId);

  const selected = (menuItems ?? []).find((mi) => mi.menuItemId === selectedMenuItemId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Recipe Builder</h1>
          <p className="text-sm text-muted-foreground">
            Pick a synced menu item to see its recipe versions and author a new one.
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
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Select a menu item…</option>
          {(menuItems ?? []).map((mi) => (
            <option key={mi.menuItemId} value={mi.menuItemId}>
              {mi.name}
            </option>
          ))}
        </select>
      </div>

      {!selectedMenuItemId ? null : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading recipe versions…</p>
      ) : versions && versions.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Version</th>
              <th className="py-2 pr-4">Current</th>
              <th className="py-2 pr-4">Effective from</th>
              <th className="py-2 pr-4">Yield (servings)</th>
              <th className="py-2 pr-4">Lines</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 pr-4">v{r.version}</td>
                <td className="py-2 pr-4">{r.current ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">{new Date(r.effectiveFrom).toLocaleDateString()}</td>
                <td className="py-2 pr-4">{r.yieldServings}</td>
                <td className="py-2 pr-4">{r.lines.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="No recipe versions yet"
          description={`${selected?.name ?? "This menu item"} has no recipe version — author one above.`}
        />
      )}
    </div>
  );
}

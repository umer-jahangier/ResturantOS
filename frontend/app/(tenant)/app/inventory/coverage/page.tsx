"use client";

import { useCoverage } from "@/lib/hooks/inventory/use-inventory";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { EmptyState } from "@/components/ui/empty-state";

// URL: /app/inventory/coverage — INV-11 recipe-coverage report: which active menu items still
// lack a recipe (D-04 vertical slice).
export default function CoveragePage() {
  const { data: coverage, isLoading } = useCoverage();

  if (isLoading || !coverage) {
    return <p className="text-sm text-muted-foreground">Loading coverage…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recipe Coverage</h1>
        <p className="text-sm text-muted-foreground">
          Which active menu items currently resolve an effective recipe.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <AnimatedNumber value={coverage.totalActiveMenuItems} />
            </CardTitle>
            <CardDescription>Total Active Menu Items</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <AnimatedNumber value={coverage.covered} />
            </CardTitle>
            <CardDescription>Covered</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <AnimatedNumber value={coverage.missing.length} />
            </CardTitle>
            <CardDescription>Missing</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {coverage.missing.length === 0 ? (
        <EmptyState title="Every active menu item has a recipe" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">Menu item</th>
            </tr>
          </thead>
          <tbody>
            {coverage.missing.map((mi) => (
              <tr key={mi.menuItemId} className="border-b">
                <td className="py-2 pr-4">{mi.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

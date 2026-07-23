"use client";

import { useState } from "react";
import { useCoverage } from "@/lib/hooks/inventory/use-inventory";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

// URL: /app/inventory/coverage — INV-15's three-state recipe-coverage report (Covered/
// Scheduled/No recipe). Every row renders the server's own `items[].state` verbatim; this page
// never re-derives coverage from a recipe's own `current` boolean (T-08.2-162) — that exact
// frontend/backend definition mismatch (the MSW mock once keyed off the recipe's `current`
// boolean while the backend used `effective_from <= now()`) is this phase's own origin bug.
export default function CoveragePage() {
  const { data: coverage, isLoading } = useCoverage();
  const [showAll, setShowAll] = useState(false);

  if (isLoading || !coverage) {
    return <p className="text-sm text-muted-foreground">Loading coverage…</p>;
  }

  const allCovered = coverage.items.every((item) => item.state === "COVERED");
  const rows = showAll ? coverage.items : coverage.items.filter((item) => item.state !== "COVERED");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recipe Coverage</h1>
        <p className="text-sm text-muted-foreground">
          Which active menu items currently resolve an effective recipe — covered, scheduled for a
          future date, or with no recipe at all.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
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
              <AnimatedNumber value={coverage.scheduled} />
            </CardTitle>
            <CardDescription>Scheduled</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <AnimatedNumber value={coverage.noRecipe} />
            </CardTitle>
            <CardDescription>No Recipe</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {allCovered ? (
        <EmptyState title="Every active menu item has a recipe" />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {showAll
                ? "Showing every active menu item."
                : "Showing menu items that still need attention — a coverage report is a worklist."}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show only gaps" : "Show all"}
            </Button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Menu item</th>
                <th className="py-2 pr-4">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.menuItemId} className="border-b">
                  <td className="py-2 pr-4">{item.name}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge
                      status={item.state}
                      label={
                        item.state === "SCHEDULED" && item.scheduledFrom
                          ? `Scheduled from ${new Date(item.scheduledFrom).toLocaleDateString()}`
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

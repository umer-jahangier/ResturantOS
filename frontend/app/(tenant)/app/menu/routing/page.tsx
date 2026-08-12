"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  useAssignCategoryStation,
  useAssignItemStation,
  useMenuRouting,
} from "@/lib/hooks/pos/use-menu-routing";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import type { CategoryRoute, ItemRoute } from "@/lib/models/menu-routing.model";
import { StationRoutingBoard } from "@/components/menu/station-routing-board";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * URL: /app/menu/routing — where each dish is cooked, at THIS branch.
 *
 * <h2>The gap this closes (register S1 #10)</h2>
 *
 * `PUT /pos/menu/items/{id}/station` and `PUT /pos/menu/categories/{id}/station` have both worked
 * since 28-05, and until this screen neither had a single caller anywhere in the product. So every
 * menu item resolved to `effectiveStationCode: null`, a check with a curry and a cocktail produced
 * ONE ticket on the DEFAULT board, and the bar screen showed nothing. The bartender never got the
 * drink — not because the pipeline was broken, but because there was no screen on which anyone
 * could say where a drink goes.
 *
 * <h2>Three rules this screen holds</h2>
 *
 * <ul>
 *   <li><b>Error before empty (GA-001).</b> Both queries go through `QueryBoundary`. "Nothing is
 *       routed" shown because pos-service is down would be the product lying about the exact
 *       question this screen exists to answer.</li>
 *   <li><b>Saving is immediate and localised.</b> One control, one decision, one PUT — with a
 *       per-row "Saving…" and a toast that names what changed. A page of forty selects behind a
 *       single Save button turns a partial failure into a screen whose state nobody can trust,
 *       and this is the screen where "I thought I saved that" costs a service.</li>
 *   <li><b>No stations is a different sentence from no routing.</b> A branch with no stations
 *       cannot route anything, so it is sent to the station catalogue instead of being shown a
 *       board of selects with one useless option.</li>
 * </ul>
 */
export default function MenuRoutingPage() {
  const { permissions } = useCurrentUser();
  const canManage = permissions.includes("pos.menu.manage");

  const routingQuery = useMenuRouting();
  const stationsQuery = useStations();
  const assignCategory = useAssignCategoryStation();
  const assignItem = useAssignItemStation();

  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  // Per-row pending sets rather than one global `isPending`: two rows can be in flight at once and
  // a shared flag would disable the whole board on the first click.
  const [pendingCategoryIds, setPendingCategoryIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(new Set());

  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);
  const routing = routingQuery.data;

  const needle = filter.trim().toLowerCase();

  const visibleItems = useMemo(() => {
    const all = routing?.items ?? [];
    return all.filter(
      (i) =>
        (showInactive || i.active) &&
        (needle === "" ||
          i.itemName.toLowerCase().includes(needle) ||
          (i.categoryName ?? "").toLowerCase().includes(needle)),
    );
  }, [routing?.items, showInactive, needle]);

  const visibleCategories = useMemo(() => {
    const all = routing?.categories ?? [];
    const withItems = new Set(visibleItems.map((i) => i.categoryId));
    return all.filter((c) => {
      if (!showInactive && !c.active) return false;
      if (needle === "") return true;
      // A category still shows when its own name matches, even with no matching items — that is
      // how somebody searching "Drinks" reaches the category-level rule they came here to set.
      return withItems.has(c.categoryId) || c.categoryName.toLowerCase().includes(needle);
    });
  }, [routing?.categories, visibleItems, showInactive, needle]);

  /** How many sellable items would land on the DEFAULT board right now. */
  const unrouted = useMemo(
    () => (routing?.items ?? []).filter((i) => i.active && !i.effectiveStationCode).length,
    [routing?.items],
  );
  const activeCount = useMemo(
    () => (routing?.items ?? []).filter((i) => i.active).length,
    [routing?.items],
  );

  function withPending(
    set: ReadonlySet<string>,
    id: string,
    present: boolean,
  ): ReadonlySet<string> {
    const next = new Set(set);
    if (present) next.add(id);
    else next.delete(id);
    return next;
  }

  function handleRouteCategory(category: CategoryRoute, stationId: string | null) {
    const station = stations.find((s) => s.id === stationId);
    setPendingCategoryIds((prev) => withPending(prev, category.categoryId, true));
    assignCategory.mutate(
      { categoryId: category.categoryId, stationId },
      {
        onSuccess: () =>
          toast.success(
            station
              ? `${category.categoryName} now fires to ${station.name} (${station.code})`
              : `${category.categoryName} is no longer routed — its tickets go to the DEFAULT board`,
          ),
        onError: (error) =>
          toast.error(error.message || "Could not save that route. Please try again."),
        onSettled: () =>
          setPendingCategoryIds((prev) => withPending(prev, category.categoryId, false)),
      },
    );
  }

  function handleRouteItem(item: ItemRoute, stationId: string | null) {
    const station = stations.find((s) => s.id === stationId);
    setPendingItemIds((prev) => withPending(prev, item.itemId, true));
    assignItem.mutate(
      { itemId: item.itemId, stationId },
      {
        onSuccess: () =>
          toast.success(
            station
              ? `${item.itemName} now fires to ${station.name} (${station.code})`
              : `${item.itemName} follows its category again`,
          ),
        onError: (error) =>
          toast.error(error.message || "Could not save that route. Please try again."),
        onSettled: () => setPendingItemIds((prev) => withPending(prev, item.itemId, false)),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Station Routing</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Where each dish is made. Route a whole category — “all drinks go to the bar” — and
            override single items where the rule does not fit. Anything with no route prints on the
            DEFAULT board. Routing is set per branch, because a station belongs to one building.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/stations">Manage stations</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="w-64"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search items or categories"
          aria-label="Search items or categories"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 rounded border-input"
          />
          Show inactive
        </label>
        {routing ? (
          <p className="text-sm text-muted-foreground" data-testid="routing-summary">
            {unrouted === 0
              ? `All ${activeCount} sellable items are routed.`
              : `${unrouted} of ${activeCount} sellable items have no station — their tickets print on the DEFAULT board.`}
          </p>
        ) : null}
      </div>

      <QueryBoundary
        query={[routingQuery, stationsQuery]}
        what="your menu routing"
        moduleLabel="Menu"
        // Deliberately NOT `visibleCategories.length === 0`: a search that matches nothing is not
        // an empty menu, and telling an owner they have no categories because they typed "xyz"
        // is the same class of lie as folding an error into an empty state.
        isEmpty={(routing?.categories.length ?? 0) === 0 || stations.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        }
        empty={
          stations.length === 0 ? (
            <EmptyState
              icon={Route}
              title="This branch has no stations yet"
              description="A station is the screen a ticket prints on — the grill, the bar, the pass. Add one and you can send a category or a single dish to it."
              action={{
                label: "Go to Stations",
                onClick: () => {
                  window.location.href = "/app/stations";
                },
              }}
            />
          ) : (
            <EmptyState
              icon={Route}
              title="No menu categories yet"
              description="Routing hangs off categories. Add a category and its items under Menu Items, then come back and say where they are made."
              action={{
                label: "Go to Menu Items",
                onClick: () => {
                  window.location.href = "/app/menu/items";
                },
              }}
            />
          )
        }
      >
        {visibleCategories.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing matches “{filter}”.
          </p>
        ) : (
          <StationRoutingBoard
            categories={visibleCategories}
            items={visibleItems}
            stations={stations}
            pendingCategoryIds={pendingCategoryIds}
            pendingItemIds={pendingItemIds}
            onRouteCategory={handleRouteCategory}
            onRouteItem={handleRouteItem}
            canManage={canManage}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

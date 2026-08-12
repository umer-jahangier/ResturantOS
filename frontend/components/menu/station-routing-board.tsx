"use client";

import { useMemo } from "react";

import type { CategoryRoute, ItemRoute, RouteSource } from "@/lib/models/menu-routing.model";
import type { Station } from "@/lib/models/pos.model";
import { Select, type SelectOption } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * The station-routing board — one category per card, its items inside it.
 *
 * <h3>Why category-first and not item-first</h3>
 *
 * "All drinks go to the bar" is one decision, and a per-item screen turns it into two hundred
 * clicks that then drift the moment somebody adds a drink. pos-service models it the same way, so
 * a category-first screen is the shape of the rule rather than a rendering of the rows.
 *
 * <h3>Every item row states BOTH facts</h3>
 *
 * The select shows the item's OWN route — "Follow category" when it has none — and the badge beside
 * it shows where the ticket actually goes and which rule sent it there. Showing only the effective
 * station would make an inherited route and a per-item exception look identical, and they behave
 * completely differently the next time the category is re-routed: one moves and one does not.
 *
 * <h3>An unrouted item says where its ticket really lands</h3>
 *
 * Not a blank cell. A blank reads as "not loaded"; the truth is that the ticket prints on the
 * DEFAULT board, which is a thing an owner can act on.
 *
 * <h3>A LEGACY row must NOT be labelled "Follow category"</h3>
 *
 * pos-service writes the pre-28-05 tenant-wide columns whenever an item route is SET, and
 * deliberately does not clear them when it is cleared. An item whose route was set once and then
 * cleared therefore has no route of its own AND does not follow its category — it falls back to
 * that old column. Offering it a control that reads "Follow category — BAR" while its tickets go
 * to the grill would be this codebase's signature defect wearing a new coat: a control that
 * describes something the system does not do. So the row says what is actually happening, and the
 * option is labelled by the state it represents rather than by the promise it cannot keep.
 */

/** Value used by the "no explicit route" option. The wire value for both is `null`. */
const UNSET = "";

const SOURCE_LABEL: Record<RouteSource, string> = {
  ITEM: "Set for this item",
  CATEGORY: "From the category",
  LEGACY: "From older settings",
  NONE: "Not routed",
};

export interface StationRoutingBoardProps {
  categories: CategoryRoute[];
  items: ItemRoute[];
  stations: Station[];
  /** Ids currently being written, so a row can say "Saving…" without freezing the screen. */
  pendingCategoryIds: ReadonlySet<string>;
  pendingItemIds: ReadonlySet<string>;
  onRouteCategory: (category: CategoryRoute, stationId: string | null) => void;
  onRouteItem: (item: ItemRoute, stationId: string | null) => void;
  /** Read-only view for a persona that can see the screen but may not write it. */
  canManage: boolean;
}

export function StationRoutingBoard({
  categories,
  items,
  stations,
  pendingCategoryIds,
  pendingItemIds,
  onRouteCategory,
  onRouteItem,
  canManage,
}: StationRoutingBoardProps) {
  const stationOptions = useMemo<SelectOption[]>(
    () => stations.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [stations],
  );

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, ItemRoute[]>();
    for (const item of items) {
      if (!item.categoryId) continue;
      const bucket = map.get(item.categoryId);
      if (bucket) bucket.push(item);
      else map.set(item.categoryId, [item]);
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-6">
      {categories.map((category) => {
        const rows = itemsByCategory.get(category.categoryId) ?? [];
        const categoryPending = pendingCategoryIds.has(category.categoryId);
        const inheritLabel = category.stationName
          ? `Follow category — ${category.stationName} (${category.stationCode})`
          : "Follow category — not routed";

        return (
          <section
            key={category.categoryId}
            data-testid="routing-category"
            data-category-name={category.categoryName}
            aria-label={`${category.categoryName} routing`}
            className="rounded-lg border"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{category.categoryName}</span>
                {!category.active ? <StatusBadge status="archived" label="Inactive" /> : null}
                <span className="text-xs text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label
                  className="text-sm text-muted-foreground"
                  htmlFor={`category-station-${category.categoryId}`}
                >
                  Everything here goes to
                </label>
                <Select
                  id={`category-station-${category.categoryId}`}
                  data-testid="category-station-select"
                  aria-label={`Station for the ${category.categoryName} category`}
                  className="w-56"
                  disabled={!canManage || categoryPending}
                  value={category.stationId ?? UNSET}
                  options={[
                    { value: UNSET, label: "Not routed — DEFAULT board" },
                    ...stationOptions,
                  ]}
                  onValueChange={(value) =>
                    onRouteCategory(category, value === UNSET ? null : value)
                  }
                />
                {/* Localised, never a whole-screen freeze (DESIGN-BRIEF §25). */}
                <span
                  aria-live="polite"
                  className="w-16 text-xs text-muted-foreground"
                  data-testid="category-station-status"
                >
                  {categoryPending ? "Saving…" : ""}
                </span>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No items in this category yet — the rule above will apply to any you add.
              </p>
            ) : (
              <div className="divide-y">
                {rows.map((item) => {
                  const itemPending = pendingItemIds.has(item.itemId);
                  const strandedOnLegacy = item.stationId === null && item.source === "LEGACY";
                  const itemInheritLabel = strandedOnLegacy
                    ? `No station of its own — an older setting sends it to ${item.effectiveStationCode}`
                    : inheritLabel;
                  return (
                    <div
                      key={item.itemId}
                      data-testid="routing-item"
                      data-item-name={item.itemName}
                      data-effective-station={item.effectiveStationCode ?? "DEFAULT"}
                      data-route-source={item.source}
                      className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                    >
                      <span className="min-w-40 flex-1 truncate">{item.itemName}</span>
                      {!item.active ? <StatusBadge status="archived" label="Inactive" /> : null}

                      <span
                        data-testid="routing-item-destination"
                        title={
                          strandedOnLegacy
                            ? "This destination comes from a setting made before per-branch routing existed, not from this screen. Choose a station explicitly to take control of it."
                            : undefined
                        }
                        className={
                          strandedOnLegacy
                            ? "shrink-0 text-amber-700 dark:text-amber-400"
                            : "shrink-0 text-muted-foreground"
                        }
                      >
                        Fires to{" "}
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                          {item.effectiveStationCode ?? "DEFAULT"}
                        </code>{" "}
                        <span className="text-xs">· {SOURCE_LABEL[item.source]}</span>
                      </span>

                      <Select
                        data-testid="item-station-select"
                        aria-label={`Station for ${item.itemName}`}
                        className="w-56 shrink-0"
                        disabled={!canManage || itemPending}
                        value={item.stationId ?? UNSET}
                        options={[
                          { value: UNSET, label: itemInheritLabel },
                          ...stationOptions,
                        ]}
                        onValueChange={(value) => onRouteItem(item, value === UNSET ? null : value)}
                      />
                      <span
                        aria-live="polite"
                        className="w-16 shrink-0 text-xs text-muted-foreground"
                        data-testid="item-station-status"
                      >
                        {itemPending ? "Saving…" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

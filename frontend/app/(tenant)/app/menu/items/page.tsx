"use client";

import { useMemo, useState } from "react";
import { CircleSlash, FolderOpen, LayoutGrid, MoreHorizontal, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import {
  useActivateMenuCategory,
  useActivateMenuItem,
  useDeactivateMenuCategory,
  useDeactivateMenuItem,
  useMenuCategoriesAdmin,
  useMenuItemsAdmin,
} from "@/lib/hooks/pos/use-menu-admin";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import type { MenuCategory, MenuItem } from "@/lib/models/pos.model";
import { MenuCategoryFormDialog } from "@/components/menu/MenuCategoryFormDialog";
import { MenuItemFormDialog } from "@/components/menu/MenuItemFormDialog";
import { MenuItemCard } from "@/components/menu/menu-item-card";
import { ModifierManagerDialog } from "@/components/menu/ModifierManagerDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { formatNumber } from "@/lib/format/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_TITLE = "No menu categories yet";
const EMPTY_BODY = "Add a category first, then add items to it — every item needs one.";

type ItemFormTarget = { mode: "create"; categoryId: string } | { mode: "edit"; item: MenuItem };
type CategoryFormTarget = { mode: "create" } | { mode: "edit"; category: MenuCategory };

// URL: /app/menu/items — self-serve menu creation. pos-service already had a complete,
// event-publishing item CRUD API; nothing in the frontend ever called it, and menu categories
// had no create path anywhere at all. This is that path — mirrors Inventory's Categories page
// (create/deactivate/reactivate, Show inactive toggle) as closely as a flat (non-tree) list
// naturally allows.
export default function MenuItemsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  // GA-001: neither query's error was read, so a pos-service failure rendered the "no menu yet"
  // empty state with an "Add category" action — on the one screen where a duplicate taxonomy is
  // most expensive, because menu categories are what every order line hangs off.
  const categoriesQuery = useMenuCategoriesAdmin();
  const itemsQuery = useMenuItemsAdmin();
  const categories = categoriesQuery.data;
  const items = itemsQuery.data;

  const activateCategory = useActivateMenuCategory();
  const deactivateCategory = useDeactivateMenuCategory();
  const activateItem = useActivateMenuItem();
  const deactivateItem = useDeactivateMenuItem();

  const [categoryTarget, setCategoryTarget] = useState<CategoryFormTarget | null>(null);
  const [itemTarget, setItemTarget] = useState<ItemFormTarget | null>(null);
  /** The dish whose modifier groups are being managed (S6), or null. */
  const [modifierTarget, setModifierTarget] = useState<MenuItem | null>(null);

  /**
   * Availability toggles in flight, keyed by item id, holding the state the user ASKED FOR
   * (plan 38-07 task 6).
   *
   * <p>The card renders `pendingAvailability[id] ?? item.active`, so the tile flips the instant
   * the button is pressed rather than after a round trip through pos-service and a query
   * invalidation. On success the key is dropped and the server's own value takes over; on failure
   * the key is dropped too — which IS the revert — and the toast names the reason. Deleting the
   * key rather than writing the old value back matters: the truth is always `item.active`, so
   * there is no second copy of availability that can go stale.
   */
  const [pendingAvailability, setPendingAvailability] = useState<Record<string, boolean>>({});

  const clearPending = (id: string) =>
    setPendingAvailability((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  const allCategories = useMemo(() => categories ?? [], [categories]);
  const allItems = useMemo(() => items ?? [], [items]);

  const visibleCategories = useMemo(
    () => (showInactive ? allCategories : allCategories.filter((c) => c.active)),
    [allCategories, showInactive],
  );

  const itemsFor = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (categoryId: string): MenuItem[] => {
      let rows = allItems.filter((i) => i.categoryId === categoryId);
      if (!showInactive) rows = rows.filter((i) => i.active);
      if (needle !== "") rows = rows.filter((i) => i.name.toLowerCase().includes(needle));
      return rows;
    };
  }, [allItems, showInactive, search]);

  // Both halves of the subtitle count the cards actually rendered below, category by category —
  // not `allItems.length`, which would state a menu size the screen is not showing.
  const shownItemCount = visibleCategories.reduce((sum, c) => sum + itemsFor(c.id).length, 0);
  const unavailableCount = visibleCategories.reduce(
    (sum, c) => sum + itemsFor(c.id).filter((i) => !(pendingAvailability[i.id] ?? i.active)).length,
    0,
  );

  const isFiltered = search.trim() !== "" || showInactive;

  /*
   * Same arrays the cards below are built from, so the strip cannot drift from the grid:
   * `shownItemCount` and `unavailableCount` are the subtitle's own figures reused, and
   * `emptyCategories` counts the categories that will render a heading with nothing sellable
   * under it — the one gap on this screen that has no card of its own to appear on.
   */
  const emptyCategories = visibleCategories.filter(
    (c) => itemsFor(c.id).filter((i) => pendingAvailability[i.id] ?? i.active).length === 0,
  ).length;

  function handleToggleCategory(category: MenuCategory) {
    const mutation = category.active ? deactivateCategory : activateCategory;
    mutation.mutate(category.id, {
      onSuccess: () =>
        toast.success(
          category.active ? `Deactivated ${category.name}` : `Reactivated ${category.name}`,
        ),
      onError: (error) =>
        toast.error(error.message || "Could not update the category. Please try again."),
    });
  }

  function handleToggleItem(item: MenuItem) {
    const next = !item.active;
    // Optimistic: the card flips now.
    setPendingAvailability((current) => ({ ...current, [item.id]: next }));
    const mutation = item.active ? deactivateItem : activateItem;
    mutation.mutate(item.id, {
      onSuccess: () => {
        clearPending(item.id);
        toast.success(item.active ? `Deactivated ${item.name}` : `Reactivated ${item.name}`);
      },
      onError: (error) => {
        // Revert, and SAY WHY. A tile that silently flips back teaches the user that the control
        // is unreliable; the server's own message is the only thing that tells them what to fix.
        clearPending(item.id);
        toast.error(
          `${next ? "Could not make" : "Could not hide"} ${item.name}${next ? " available" : ""} — ${
            error.message || "the menu service did not accept the change."
          }`,
        );
      },
    });
  }

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Menu Items"
        description="What's sellable, organized into categories — write a recipe for an item under Inventory › Recipes once it's here."
        meta={statLine(
          filteredCountLine(shownItemCount, allItems.length, "item"),
          countLine(visibleCategories.length, "category", "categories"),
          unavailableCount > 0 ? `${unavailableCount} unavailable` : null,
        )}
        actions={
          <PermissionGuard require="pos.menu.manage">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCategoryTarget({ mode: "create" })}
              >
                Add category
              </Button>
              <Button
                type="button"
                disabled={allCategories.filter((c) => c.active).length === 0}
                onClick={() =>
                  setItemTarget({
                    mode: "create",
                    categoryId: allCategories.find((c) => c.active)?.id ?? "",
                  })
                }
              >
                Add item
              </Button>
            </div>
          </PermissionGuard>
        }
      />

      <div className="grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Items shown"
          value={formatNumber(shownItemCount)}
          icon={UtensilsCrossed}
          accent="primary"
        />
        <StatTile
          label="Categories on the menu"
          value={formatNumber(visibleCategories.length)}
          icon={LayoutGrid}
          accent="secondary"
        />
        <StatTile
          label="Unavailable right now"
          value={formatNumber(unavailableCount)}
          icon={CircleSlash}
        />
        <StatTile
          label="Categories with nothing sellable"
          value={formatNumber(emptyCategories)}
          icon={FolderOpen}
        />
      </div>

      <FilterBar
        title="Menu"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search menu items",
          placeholder: "Search dishes…",
        }}
        // No category filter, deliberately: this screen is ORGANISED by category, so a category
        // dropdown would be a second, weaker copy of the structure already on screen — and it
        // would print every category name twice, once in the list and once as its own heading.
        extraActiveCount={showInactive ? 1 : 0}
        onClearAll={() => {
          setSearch("");
          setShowInactive(false);
        }}
      >
        {/* A deactivated category or item is invisible to the order-taking grid but not deleted —
            without this toggle there is no way to find, or reactivate, one again. Mirrors
            Inventory Categories' "Show archived" checkbox exactly. */}
        <label className="flex min-h-11 w-fit items-center gap-2 text-small text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 rounded-sm border-input"
          />
          Show inactive
        </label>
      </FilterBar>

      <QueryBoundary
        query={[categoriesQuery, itemsQuery]}
        what="the menu"
        isEmpty={visibleCategories.length === 0 && !isFiltered}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <PermissionGuard
            require="pos.menu.manage"
            fallback={<EmptyState title={EMPTY_TITLE} description={EMPTY_BODY} />}
          >
            <EmptyState
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{
                label: "Add category",
                onClick: () => setCategoryTarget({ mode: "create" }),
              }}
            />
          </PermissionGuard>
        }
      >
        {visibleCategories.length === 0 ? (
          <EmptyState
            title="Nothing matches these filters."
            description="Try widening or clearing them to see more."
            action={{
              label: "Clear all",
              onClick: () => {
                setSearch("");
                setShowInactive(false);
              },
            }}
          />
        ) : (
          <div className="space-y-(--space-xl)">
            {visibleCategories.map((category) => {
              const rows = itemsFor(category.id);
              return (
                <section
                  key={category.id}
                  role="group"
                  aria-label={`${category.name} category`}
                  className="space-y-(--space-md)"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-(--space-sm)">
                    <div className="flex items-center gap-2">
                      <h2 className="text-h2 font-semibold">{category.name}</h2>
                      <span className="text-small text-foreground-tertiary">
                        {countLine(rows.length, "item")}
                      </span>
                      {!category.active ? <StatusBadge status="archived" label="Inactive" /> : null}
                    </div>
                    <PermissionGuard require="pos.menu.manage">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11"
                          onClick={() => setItemTarget({ mode: "create", categoryId: category.id })}
                          disabled={!category.active}
                        >
                          Add item
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-11"
                              aria-label={`Actions for ${category.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setCategoryTarget({ mode: "edit", category })}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleToggleCategory(category)}>
                              {category.active ? "Deactivate" : "Reactivate"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </PermissionGuard>
                  </div>

                  {rows.length === 0 ? (
                    <p className="text-small text-muted-foreground">
                      {search.trim() === ""
                        ? "No items in this category yet."
                        : "No items in this category match this search."}
                    </p>
                  ) : (
                    // The demo's `auto-fill minmax()` tile grid (DEMO-SCREENS §3), which is what
                    // makes this readable on a phone without a horizontal scroll.
                    <div className="grid gap-(--space-md) [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
                      {rows.map((item) => (
                        <MenuItemCard
                          key={item.id}
                          name={item.name}
                          imageUrl={item.imageUrl}
                          basePricePaisa={item.basePricePaisa}
                          // The category is the section heading directly above this grid, so
                          // repeating it on every card adds noise, not information.
                          available={pendingAvailability[item.id] ?? item.active}
                          isPending={item.id in pendingAvailability}
                          onToggleAvailability={() => handleToggleItem(item)}
                          actions={
                            <PermissionGuard require="pos.menu.manage">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-11"
                                    aria-label={`Actions for ${item.name}`}
                                  >
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => setItemTarget({ mode: "edit", item })}
                                  >
                                    Edit
                                  </DropdownMenuItem>
                                  {/* S6 — the route to the modifier catalogue. There was no
                                      screen anywhere in the product that could create one, which
                                      is why the entities had sat unused since V1. */}
                                  <DropdownMenuItem
                                    data-testid={`manage-options-${item.id}`}
                                    onSelect={() => setModifierTarget(item)}
                                  >
                                    Options &amp; add-ons
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => handleToggleItem(item)}>
                                    {item.active ? "Deactivate" : "Reactivate"}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </PermissionGuard>
                          }
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </QueryBoundary>

      <MenuCategoryFormDialog
        key={
          categoryTarget
            ? categoryTarget.mode === "edit"
              ? `edit-${categoryTarget.category.id}`
              : "create"
            : "category-form-idle"
        }
        category={categoryTarget?.mode === "edit" ? categoryTarget.category : undefined}
        open={categoryTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCategoryTarget(null);
        }}
      />

      <MenuItemFormDialog
        key={
          itemTarget
            ? itemTarget.mode === "edit"
              ? `edit-${itemTarget.item.id}`
              : `create-${itemTarget.categoryId}`
            : "item-form-idle"
        }
        item={itemTarget?.mode === "edit" ? itemTarget.item : undefined}
        defaultCategoryId={itemTarget?.mode === "create" ? itemTarget.categoryId : undefined}
        open={itemTarget !== null}
        onOpenChange={(next) => {
          if (!next) setItemTarget(null);
        }}
      />

      <ModifierManagerDialog
        key={modifierTarget ? `modifiers-${modifierTarget.id}` : "modifiers-idle"}
        item={modifierTarget}
        onOpenChange={(next) => {
          if (!next) setModifierTarget(null);
        }}
      />
    </PageBody>
  );
}

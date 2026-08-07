"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  useActivateMenuCategory,
  useActivateMenuItem,
  useDeactivateMenuCategory,
  useDeactivateMenuItem,
  useMenuCategoriesAdmin,
  useMenuItemsAdmin,
} from "@/lib/hooks/pos/use-menu-admin";
import type { MenuCategory, MenuItem } from "@/lib/models/pos.model";
import { MenuCategoryFormDialog } from "@/components/menu/MenuCategoryFormDialog";
import { MenuItemFormDialog } from "@/components/menu/MenuItemFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Button } from "@/components/ui/button";
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

  const allCategories = categories ?? [];
  const visibleCategories = showInactive ? allCategories : allCategories.filter((c) => c.active);
  const allItems = items ?? [];

  function itemsFor(categoryId: string): MenuItem[] {
    const rows = allItems.filter((i) => i.categoryId === categoryId);
    return showInactive ? rows : rows.filter((i) => i.active);
  }

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
    const mutation = item.active ? deactivateItem : activateItem;
    mutation.mutate(item.id, {
      onSuccess: () =>
        toast.success(item.active ? `Deactivated ${item.name}` : `Reactivated ${item.name}`),
      onError: (error) =>
        toast.error(error.message || "Could not update the item. Please try again."),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Menu Items</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s sellable, organized into categories — write a recipe for an item under
            Inventory › Recipes once it&apos;s here.
          </p>
        </div>
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
      </div>

      {/* A deactivated category or item is invisible to the order-taking grid but not deleted —
          without this toggle there is no way to find, or reactivate, one again. Mirrors
          Inventory Categories' "Show archived" checkbox exactly. */}
      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Show inactive
      </label>

      <QueryBoundary
        query={[categoriesQuery, itemsQuery]}
        what="the menu"
        isEmpty={visibleCategories.length === 0}
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
        <div className="space-y-6">
          {visibleCategories.map((category) => {
            const rows = itemsFor(category.id);
            return (
              <div
                key={category.id}
                role="group"
                aria-label={`${category.name} category`}
                className="rounded-lg border"
              >
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{category.name}</span>
                    {!category.active ? <StatusBadge status="archived" label="Inactive" /> : null}
                  </div>
                  <PermissionGuard require="pos.menu.manage">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No items in this category yet.
                  </p>
                ) : (
                  <div className="divide-y">
                    {rows.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="flex-1 truncate">{item.name}</span>
                        <MoneyDisplay paisa={item.basePricePaisa} className="shrink-0" />
                        {!item.active ? <StatusBadge status="archived" label="Inactive" /> : null}
                        <PermissionGuard require="pos.menu.manage">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
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
                              <DropdownMenuItem onSelect={() => handleToggleItem(item)}>
                                {item.active ? "Deactivate" : "Reactivate"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </PermissionGuard>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
    </div>
  );
}

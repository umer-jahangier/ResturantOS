"use client";

import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { useMenuCategories, useMenuItems } from "@/lib/hooks/pos/use-menu";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { MenuItemImage } from "@/components/menu/MenuItemImage";
import { MenuScopeSwitch } from "@/components/pos/menu-scope-switch";
import { cartLineKey, type CartLine } from "@/components/pos/cart-reducer";
import type { MenuItem } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface MenuGridProps {
  onItemSelect: (item: MenuItem) => void;
  /**
   * The live cart (lifted state in PosTerminal) — used only to derive each plain
   * (no-modifier) menu item's selected quantity so the grid can highlight it. Cart
   * state itself lives above MenuGrid and outlives category switches/remounts, so
   * highlighting naturally persists as the cashier moves between categories.
   */
  cart: CartLine[];
  onRemove: (key: string) => void;
  /** Clears every line from the pre-send cart — only ever wired/shown before punch-in. */
  onClearCart: () => void;
}

export function MenuGrid({ onItemSelect, cart, onRemove, onClearCart }: MenuGridProps) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(undefined);
  /*
   * The admin's own switch (Program A). A VIEW state, held here and nowhere else: it is not
   * persisted, not sent, and not a permission. `null` means "not previewing" — see
   * `MenuScopeSwitch`'s comment for why an admin is not granted every category instead.
   */
  const [scopePreview, setScopePreview] = useState<string[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // UI-SPEC §3: pure client-side filter over the currently-loaded category, 150ms
  // debounced (no server round-trip per keystroke — menu is ≤ ~60 items at this scale).
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  /*
   * S1-09. These two reads used to be destructured as `{ data: items = [], isLoading }` with
   * `isError` never taken at all — GA-001 bug shape 2, verbatim. With pos-service stopped, both
   * queries rejected with a gateway 503, `items` fell back to `[]` one line later, `itemsLoading`
   * went false, and the grid rendered the sentence "No items available" in the product's own
   * confident voice. Driven live on 2026-08-12: four 503s on the network tab, zero `[role=alert]`
   * anywhere on the page. A cashier reads that as "the owner has not added the menu yet".
   *
   * The queries are now held whole so the error cannot be dropped on the way to the render, and
   * the failure branch is checked BEFORE the empty branch, which is the only ordering in which
   * "there are no items" is an honest thing to say.
   */
  const categoriesQuery = useMenuCategories();
  const itemsQuery = useMenuItems(activeCategoryId);
  const categories = categoriesQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  // `isLoading` (= isPending && isFetching), NOT `isPending`. A DISABLED TanStack v5 query reports
  // isPending forever, and this grid's two reads are gated on `isAuthenticated && !!branchId` —
  // reading isPending here would pin a permanent skeleton over the whole menu the moment a branch
  // id is briefly absent. Same trap `table-floor-view.tsx` records; the only change in this commit
  // is that the ERROR is no longer discarded, not how loading is decided.
  const categoriesLoading = categoriesQuery.isLoading;
  const itemsLoading = itemsQuery.isLoading;

  const serverCategories = categories.filter((c) => c.active);
  // What the RAIL offers. The server already narrowed `categories` to this operator's scope; the
  // preview narrows the view further, on this screen only.
  const activeCategories = scopePreview
    ? serverCategories.filter((c) => scopePreview.includes(c.id))
    : serverCategories;
  // The items are narrowed too, not just the pills. With "All" selected the server hands back
  // every item this operator may see, so filtering the rail alone would leave a preview that
  // renamed the tabs and changed nothing underneath them.
  const activeItems = items.filter(
    (i) => i.active && (!scopePreview || (i.categoryId !== null && scopePreview.includes(i.categoryId))),
  );
  const trimmedQuery = debouncedSearch.trim().toLowerCase();
  const filteredItems = trimmedQuery
    ? activeItems.filter((i) => i.name.toLowerCase().includes(trimmedQuery))
    : activeItems;

  /*
   * S7. Does anything on screen have a photograph?
   *
   * <p>The picture was on the model and served by the API all along; this grid rendered neither.
   * Measured on 2026-08-12 as the cashier: 44 tiles, ZERO `<img>` elements, including the item
   * literally named "Photo Dish 50585" — and the same picture painting fine one screen away on
   * /app/menu/items at its true 120×120.
   *
   * <p>Whether a tile gets a photo slot is decided for the WHOLE visible set, not per item. A
   * restaurant photographs its menu gradually, so a per-item decision produces exactly the ragged
   * grid the brief forbids: tall tiles beside short ones, the row height set by whichever dish
   * happened to be shot first. Uniform means the cashier's thumb lands where they aimed.
   *
   * <p>And when nothing is photographed — the common case for a new tenant, and for a drinks
   * category nobody shoots — no tile gets a slot at all, so the till does not spend a third of a
   * touchscreen on 44 identical grey rectangles to say "no picture" 44 times.
   */
  const showImages = filteredItems.some((i) => !!i.imageUrl);

  // Plain (no modifier/notes) menu taps always land on the `menuItemId::::` cart
  // line — map menuItemId -> quantity so the grid can highlight/badge selected
  // items. Lines with modifiers/notes (added elsewhere) intentionally don't
  // highlight a grid tile since they're not a 1:1 match for a bare menu tap.
  const quantityByMenuItemId = useMemo(() => {
    const map = new Map<string, { key: string; quantity: number }>();
    for (const line of cart) {
      if (line.modifiers.length > 0 || line.notes) continue;
      map.set(line.menuItemId, {
        key: cartLineKey(line.menuItemId, [], null),
        quantity: line.quantity,
      });
    }
    return map;
  }, [cart]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Menu search (POS-15): full-width, 44px, debounced 150ms, clearable */}
      <div className="relative px-1">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search menu…"
          aria-label="Search menu"
          className="h-11 pl-10 pr-9"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 min-h-[32px] min-w-[32px] -translate-y-1/2 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/*
        The admin's own switch, ABOVE the rail rather than inside it, because the rail answers
        "which section am I looking at" and this answers "which sections exist for me right now" —
        two questions one row of pills cannot ask at once without the second looking like a
        multi-select version of the first.
      */}
      <MenuScopeSwitch
        categories={serverCategories}
        preview={scopePreview}
        onPreviewChange={(next) => {
          setScopePreview(next);
          // The selected tab may no longer be on the rail. Dropping to "All" is the only choice
          // that cannot leave the grid pinned to a category the operator can no longer see —
          // which reads as an empty menu with no way back.
          setActiveCategoryId(undefined);
        }}
      />

      {/* Category pills + Clear All (extreme right, pre-send cart only) */}
      <div className="flex items-center gap-2 px-1">
        {/*
          One scrolling row on a phone, wrapped on a till (S6).

          <p>It wrapped at every width. On a 390px screen this tenant's nine categories became
          THREE rows of pills — ~130px — and together with the till strip, the three tabs and the
          search box that pushed the first menu tile to y=520 on an 844px screen, below the order
          panel. Measured, not estimated: the cashier could not tap a dish at all, and therefore
          could not reach the configure dialog behind it. A category row is a rail, not a
          paragraph; a till with forty categories should scroll it, not grow a wall.
        */}
        <div className="flex flex-1 gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
          <button
            onClick={() => setActiveCategoryId(undefined)}
            className={cn(
              "min-h-11 shrink-0 px-4 py-2 rounded-full text-pos font-medium transition-colors",
              !activeCategoryId
                ? "bg-primary-solid text-primary-solid-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            All
          </button>
          {categoriesLoading ? (
            <div className="h-9 w-20 rounded-full bg-muted animate-pulse" />
          ) : (
            activeCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={cn(
                  "min-h-11 shrink-0 px-4 py-2 rounded-full text-pos font-medium transition-colors",
                  activeCategoryId === cat.id
                    ? "bg-primary-solid text-primary-solid-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {cat.name}
              </button>
            ))
          )}
        </div>
        {cart.length > 0 && (
          <button
            type="button"
            data-testid="clear-all-button"
            onClick={() => setClearDialogOpen(true)}
            aria-label="Clear all items from cart"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Clear All
          </button>
        )}
      </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all items?</DialogTitle>
            <DialogDescription>
              This removes every item from the current cart. Nothing has been saved yet, so this
              cannot be undone once confirmed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClearDialogOpen(false)}>
              Keep Items
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="clear-all-confirm-button"
              onClick={() => {
                onClearCart();
                setClearDialogOpen(false);
              }}
            >
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        How many tiles the cashier is looking at. Small, but it is the difference between a grid
        that is complete and a grid that merely looks complete: this screen used to render the
        first 20 items of any longer menu with nothing on it to say so, and the cashier's only
        clue was an item they knew existed refusing to be found. A count cannot be silently wrong.
      */}
      {!itemsLoading && activeItems.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground" data-testid="menu-item-count">
          {trimmedQuery
            ? `${filteredItems.length} of ${activeItems.length} items match`
            : `${activeItems.length} items`}
        </p>
      )}

      {/* Menu item grid — 2/3/4 col responsive, min 100x100 touch cards */}
      <div className="flex-1 overflow-y-auto">
        {itemsQuery.isError || categoriesQuery.isError ? (
          /*
           * Error before empty, and before loading. A failed read has no trustworthy `data`, so
           * "there are no items" is not a question that can honestly be asked yet — the whole
           * lesson of GA-001. `stillWorks` is the sentence that decides what the cashier does in
           * the next thirty seconds: whether they turn the queue away or walk to the pass.
           */
          <div className="p-1">
            <QueryErrorNotice
              what="the menu"
              moduleLabel="POS"
              error={itemsQuery.error ?? categoriesQuery.error}
              stillWorks="Tickets already sent to the kitchen are unaffected, and the kitchen display keeps working."
              isRetrying={itemsQuery.isFetching || categoriesQuery.isFetching}
              onRetry={() => {
                void itemsQuery.refetch();
                void categoriesQuery.refetch();
              }}
            />
          </div>
        ) : itemsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            {trimmedQuery ? "No items match your search" : "No items available"}
          </div>
        ) : (
          <div
            data-testid="menu-grid"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-1"
          >
            {filteredItems.map((item, idx) => {
              const selected = quantityByMenuItemId.get(item.id);
              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    data-testid={idx === 0 ? "menu-item-first" : undefined}
                    onClick={() => onItemSelect(item)}
                    aria-pressed={!!selected}
                    className={cn(
                      "min-h-[100px] min-w-[100px] w-full overflow-hidden rounded-xl border text-left transition-colors flex flex-col active:scale-95",
                      showImages ? "justify-start" : "justify-between p-3",
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border bg-card hover:bg-accent hover:border-primary",
                    )}
                  >
                    {/*
                      The photo sits ABOVE the words, never behind them. An overlaid caption needs
                      a scrim to stay readable, and a scrim on a POS tile means a `filter` or
                      `backdrop-filter` on an ancestor of the layout — which is precisely what
                      breaks the receipt print path. Stacking costs one row of pixels and makes the
                      name and price legible over every photograph, including a white plate.
                    */}
                    {showImages && (
                      <MenuItemImage
                        variant="cover"
                        imageUrl={item.imageUrl}
                        name={item.name}
                        className="aspect-[4/3] w-full border-b"
                      />
                    )}
                    <span
                      className={cn(
                        "flex flex-1 flex-col justify-between gap-0.5",
                        showImages && "p-2.5",
                      )}
                    >
                      <span className="font-medium text-sm line-clamp-2">{item.name}</span>
                      <MoneyDisplay
                        paisa={item.basePricePaisa}
                        className="text-sm text-muted-foreground font-mono"
                      />
                    </span>
                  </button>
                  {selected && (
                    <>
                      <span
                        data-testid={`menu-item-qty-${item.id}`}
                        className="pointer-events-none absolute -top-2 -right-2 flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary-solid px-1 text-xs font-semibold text-primary-solid-foreground"
                      >
                        {selected.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemove(selected.key)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="absolute -top-2 -left-2 flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive hover:border-destructive"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

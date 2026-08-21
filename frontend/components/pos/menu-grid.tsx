"use client";

import { useMemo, useState } from "react";
import { Ban, Plus, Search, Trash2, X } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { MenuItemImage } from "@/components/menu/MenuItemImage";
import { MenuScopeSwitch } from "@/components/pos/menu-scope-switch";
import { cartLineKey, type CartLine } from "@/components/pos/cart-reducer";
import { menuItemAvailability, setHasAvailabilitySignal } from "@/components/pos/menu-availability";
import type { MenuItem } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

/**
 * The tile grid track, and the one thing the demo's POS does better than ours did.
 *
 * <p>We had `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` — three hard-coded column counts, so the
 * tile width was whatever the viewport divided by 2, 3 or 4 happened to be. At 390px that is a
 * 185px tile; between `sm` and `lg` on a 900px tablet it is 300px, a third of the screen for one
 * dish; and at 1440px with the sidebar now gone it is a 260px tile, so a 40-item card needs
 * scrolling that `auto-fill` would not.
 *
 * <p>`repeat(auto-fill, minmax(130px, 1fr))` (`DEMO-SCREENS.md` §3, adopted under D-38-15) states
 * the thing that actually matters — **no tile is ever narrower than 130px** — and lets the browser
 * pick the count. One rule, every width, no breakpoint to forget. The minimum comfortably clears
 * UI-SPEC §9.2's 56px floor on both axes; the tiles are ~130×100 at their smallest.
 */
const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))]";

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
  /*
   * S7 + 38-04: the scope preview narrows this; `active` no longer DELETES from it.
   *
   * <p>`i.active` used to be an `&&` in this filter, so a deactivated dish vanished from the grid
   * with nothing said. The server list is active-only anyway (`PosRepository.getMenuItems`), so on
   * a real till this changes what is on screen not at all — but when a row does arrive inactive,
   * the cashier now gets an unsellable tile that says why instead of a dish that is simply not
   * there. See `menu-availability.ts` for what the system can and cannot honestly claim here.
   */
  const scopedItems = items.filter(
    (i) => !scopePreview || (i.categoryId !== null && scopePreview.includes(i.categoryId)),
  );
  const trimmedQuery = debouncedSearch.trim().toLowerCase();
  const filteredItems = trimmedQuery
    ? scopedItems.filter((i) => i.name.toLowerCase().includes(trimmedQuery))
    : scopedItems;

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
  /* The same whole-set decision, for the same reason — see `setHasAvailabilitySignal`. */
  const showAvailability = setHasAvailabilitySignal(filteredItems);

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
            className="touch-target absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
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
            /*
              `Skeleton`, not a hand-rolled `animate-pulse` div (D-38-04). This grid sits on
              `app/pos/**`, an `operational` surface, where the contract is depth cues only — no
              decorative motion. `animate-pulse` is PERPETUAL: it runs for as long as the request
              is in flight, which on a slow till is exactly when the cashier is looking.

              The same defect was fixed one file over, in `table-floor-view.tsx`, in the same
              change set — so this was a selectively-applied fix, not an unknown rule. The shared
              component already encodes it: it reads the zone and renders a flat `--muted` block
              here while still shimmering on the dashboard.
            */
            <Skeleton className="h-9 w-20 rounded-full" />
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
            className="touch-target inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 text-small font-medium text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
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
      {!itemsLoading && scopedItems.length > 0 && (
        <p className="px-1 text-label text-muted-foreground" data-testid="menu-item-count">
          {trimmedQuery
            ? `${filteredItems.length} of ${scopedItems.length} items match`
            : `${scopedItems.length} items`}
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
          <div className={cn("gap-3 p-1", TILE_GRID)}>
            {Array.from({ length: 8 }).map((_, i) => (
              // Same defect as the category pill above, eight tiles at a time: this is the
              // placeholder the cashier actually stares at while the menu loads.
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-body text-muted-foreground">
            {trimmedQuery ? "No items match your search" : "No items available"}
          </div>
        ) : (
          <div data-testid="menu-grid" className={cn("gap-3 p-1", TILE_GRID)}>
            {filteredItems.map((item, idx) => {
              const selected = quantityByMenuItemId.get(item.id);
              const availability = menuItemAvailability(item);
              const sellable = availability === "available";
              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    data-testid={idx === 0 ? "menu-item-first" : undefined}
                    onClick={() => onItemSelect(item)}
                    disabled={!sellable}
                    aria-pressed={!!selected}
                    className={cn(
                      "flex min-h-[100px] w-full flex-col overflow-hidden rounded-xl border text-left transition-colors active:scale-95",
                      showImages ? "justify-start" : "justify-between p-3",
                      !sellable
                        ? "cursor-not-allowed border-dashed bg-muted/40 opacity-70 active:scale-100"
                        : selected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border bg-card hover:border-primary hover:bg-accent",
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
                        "flex flex-1 flex-col justify-between gap-1",
                        showImages && "p-2.5",
                      )}
                    >
                      {/*
                        `--text-pos` — 17/24 at weight 500 (UI-SPEC §9.2, §3). Not `text-sm`.
                        The whole reason a POS type role exists is that this string is read at
                        arm's length, in a hurry, by someone whose eyes are on the guest.
                      */}
                      <span className="line-clamp-2 text-pos font-medium">{item.name}</span>
                      <span className="flex items-center justify-between gap-2">
                        <MoneyDisplay
                          paisa={item.basePricePaisa}
                          className="font-mono text-body text-muted-foreground"
                        />
                        {/*
                          Quick-add, made visible (§9.2). The affordance, not a second control:
                          the TILE is the add target and it is already ~130×100, so a nested
                          button would be both invalid HTML inside this <button> and a smaller,
                          worse version of a target that is already there. This says "tap me to
                          add" without shrinking the thing you tap.

                          The demo puts a 22px +/- pair on its ticket rows instead; rejected under
                          D-38-15 — half the minimum a thumb needs, and discoverable only on hover,
                          which a terminal does not have.
                        */}
                        {sellable && !selected && (
                          <span
                            aria-hidden="true"
                            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                          >
                            <Plus className="size-3.5" />
                          </span>
                        )}
                        {/* Reserves the corner so the remove control below never lands on words. */}
                        {selected && <span aria-hidden="true" className="size-6 shrink-0" />}
                      </span>
                      {/*
                        Availability — icon SHAPE + literal words + hue, never hue alone (§4.2 /
                        D-38-13). Rendered only when the visible set actually has something to
                        report; see menu-availability.ts for why there is no "Low Stock" here.
                      */}
                      {showAvailability && (
                        <span
                          data-testid={`menu-item-availability-${item.id}`}
                          className={cn(
                            "flex items-center gap-1 text-label font-medium",
                            sellable ? "text-success" : "text-muted-foreground",
                          )}
                        >
                          {sellable ? (
                            <>
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-success"
                              />
                              Available
                            </>
                          ) : (
                            <>
                              <Ban className="size-3" aria-hidden="true" />
                              Unavailable
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                  {selected && (
                    <>
                      <span
                        data-testid={`menu-item-qty-${item.id}`}
                        className="pointer-events-none absolute -top-2 right-1 flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full bg-primary-solid px-1 text-label font-semibold text-primary-solid-foreground"
                      >
                        {selected.quantity}
                      </span>
                      {/*
                        44×44 hit area, 24px visual (§9.2 "every interactive target ≥ 44 × 44px").
                        It was a bare 22×22 circle — the same size the demo uses for its quantity
                        buttons and the same size D-38-15 rejects.

                        <p>BOTTOM-RIGHT, and that is measured rather than styled. At the top-left
                        corner, where it used to sit, a 44px box reaches ~30px into the tile and
                        lands squarely on the dish name — photographed at 1440px covering the first
                        two characters of "Mutton Karahi (Half)". The bottom-right corner is the one
                        region of the tile that carries nothing: the name is top-aligned, the price
                        and the availability row are left-aligned, and the quick-add glyph that
                        normally sits here is hidden the moment a tile is selected.
                      */}
                      <button
                        type="button"
                        onClick={() => onRemove(selected.key)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="touch-target absolute bottom-0 right-0 flex items-center justify-center"
                      >
                        <span className="flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground hover:border-destructive hover:text-destructive">
                          <X className="size-3" aria-hidden="true" />
                        </span>
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

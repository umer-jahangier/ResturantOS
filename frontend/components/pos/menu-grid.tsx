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
  const [searchQuery, setSearchQuery] = useState("");
  // UI-SPEC §3: pure client-side filter over the currently-loaded category, 150ms
  // debounced (no server round-trip per keystroke — menu is ≤ ~60 items at this scale).
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  const { data: categories = [], isLoading: categoriesLoading } = useMenuCategories();
  const { data: items = [], isLoading: itemsLoading } = useMenuItems(activeCategoryId);

  const activeCategories = categories.filter((c) => c.active);
  const activeItems = items.filter((i) => i.active);
  const trimmedQuery = debouncedSearch.trim().toLowerCase();
  const filteredItems = trimmedQuery
    ? activeItems.filter((i) => i.name.toLowerCase().includes(trimmedQuery))
    : activeItems;

  // Plain (no modifier/notes) menu taps always land on the `menuItemId::::` cart
  // line — map menuItemId -> quantity so the grid can highlight/badge selected
  // items. Lines with modifiers/notes (added elsewhere) intentionally don't
  // highlight a grid tile since they're not a 1:1 match for a bare menu tap.
  const quantityByMenuItemId = useMemo(() => {
    const map = new Map<string, { key: string; quantity: number }>();
    for (const line of cart) {
      if (line.modifierIds.length > 0 || line.notes) continue;
      map.set(line.menuItemId, { key: cartLineKey(line.menuItemId, [], null), quantity: line.quantity });
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

      {/* Category pills + Clear All (extreme right, pre-send cart only) */}
      <div className="flex items-center gap-2 px-1">
        <div className="flex flex-1 flex-wrap gap-2">
          <button
            onClick={() => setActiveCategoryId(undefined)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-colors",
              !activeCategoryId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
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
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  activeCategoryId === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
            >
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

      {/* Menu item grid — 2/3/4 col responsive, min 100x100 touch cards */}
      <div className="flex-1 overflow-y-auto">
        {itemsLoading ? (
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
          <div data-testid="menu-grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-1">
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
                      "min-h-[100px] min-w-[100px] w-full rounded-xl border p-3 text-left transition-colors flex flex-col justify-between active:scale-95",
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border bg-card hover:bg-accent hover:border-primary",
                    )}
                  >
                    <span className="font-medium text-sm line-clamp-2">{item.name}</span>
                    <MoneyDisplay
                      paisa={item.basePricePaisa}
                      className="text-sm text-muted-foreground font-mono"
                    />
                  </button>
                  {selected && (
                    <>
                      <span
                        data-testid={`menu-item-qty-${item.id}`}
                        className="pointer-events-none absolute -top-2 -right-2 flex min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
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

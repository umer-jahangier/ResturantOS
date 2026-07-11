"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { useMenuCategories, useMenuItems } from "@/lib/hooks/pos/use-menu";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Input } from "@/components/ui/input";
import type { MenuItem } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface MenuGridProps {
  onItemSelect: (item: MenuItem) => void;
}

export function MenuGrid({ onItemSelect }: MenuGridProps) {
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

      {/* Category pills */}
      <div className="flex gap-2 flex-wrap px-1">
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
            {filteredItems.map((item, idx) => (
              <button
                key={item.id}
                data-testid={idx === 0 ? "menu-item-first" : undefined}
                onClick={() => onItemSelect(item)}
                className="min-h-[100px] min-w-[100px] rounded-xl border bg-card p-3 text-left hover:bg-accent hover:border-primary transition-colors flex flex-col justify-between active:scale-95"
              >
                <span className="font-medium text-sm line-clamp-2">{item.name}</span>
                <MoneyDisplay
                  paisa={item.basePricePaisa}
                  className="text-sm text-muted-foreground font-mono"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

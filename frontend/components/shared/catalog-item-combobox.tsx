"use client";

import * as React from "react";
import { Command } from "cmdk";
import { ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoneyDisplay } from "@/components/ui/money-display";

export interface CatalogItemOption {
  id: string;
  name: string;
  secondary?: string;
  sku?: string;
  pricePaisa?: number | null;
}

interface CatalogItemComboboxProps {
  options: CatalogItemOption[];
  value: string | null;
  onSelect: (option: CatalogItemOption) => void;
  disabled?: boolean;
  disabledPlaceholder?: string;
  placeholder?: string;
  emptyHeading?: string;
  /**
   * Usually a sentence. Accepts a node so a caller whose options come from another service can
   * offer a way OUT of the empty state — a retry, a link — rather than only describing it.
   */
  emptyBody?: React.ReactNode;
  isLoading?: boolean;
  /**
   * Whether the request that produced `options` FAILED.
   *
   * <h3>Why a picker needs its own error state at all</h3>
   *
   * Six dialogs destructured `useIngredients()` as `const { data: ingredients } = …` and dropped
   * `isError` on the floor — bug shape 2 from `query-boundary.tsx`'s docblock, verbatim, at the
   * size of one dropdown. A failed catalog became a zero-length array one line later, and this
   * component then told the reader *"No ingredients match — try a different search."*
   *
   * <p>That sentence is GA-001: it reports the empty result of a search that never ran. Someone
   * counting stock reads it as "this ingredient is not set up", and the next thing they do is
   * create a duplicate ingredient — a write, against a service that is down, which the count
   * sheet will then carry for ever.
   *
   * <p>The failure branch is checked BEFORE the empty branch here for the same reason
   * `QueryBoundary` checks it first: a list that failed to load has no trustworthy length, so
   * "is it empty?" is not yet an honest question.
   */
  isError?: boolean;
  /** Offered inside the failure notice. Omit it and the notice names the failure without a retry. */
  onRetry?: () => void;
  /** What failed, in the reader's words — "ingredients", "this vendor's catalog". */
  errorLabel?: string;
  /**
   * Replaces the generic failure sentence for a caller that knows more than "it didn't load".
   *
   * <p>`GlAccountCombobox` is the case this exists for: it tells a 403 from a 503 from a parse
   * failure and says which of them happened, and collapsing that into one sentence would be a
   * downgrade. What it could NOT do on its own is give the notice `role="alert"` and the
   * destructive ramp, because both live in here — so the copy stays with the caller and the
   * SALIENCE stays with the component. Neither half is optional and neither belongs to the
   * other.
   */
  errorHeading?: React.ReactNode;
  errorBody?: React.ReactNode;
  onSearchChange?: (query: string) => void;
  className?: string;
}

function matchesQuery(option: CatalogItemOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.name.toLowerCase().includes(q) ||
    (option.secondary?.toLowerCase().includes(q) ?? false) ||
    (option.sku?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Anchored (non-full-screen) search-as-you-type picker — the one shared combobox every
 * ingredient/vendor-item picker in this phase reuses (UI-SPEC §5, "Build once, reuse
 * everywhere"). Built on cmdk's `Command` for filtering/keyboard-nav, anchored via the new
 * `Popover` wrapper instead of the full-screen `Dialog` `command-palette.tsx` uses.
 *
 * Filtering is a controlled case-insensitive substring match over name/secondary/sku — cmdk's
 * own fuzzy scoring is disabled (`shouldFilter={false}`) so the result set matches this
 * component's documented contract exactly; `onSearchChange` lets a caller drive server-side
 * search off the same keystrokes when the option list itself comes from the server.
 */
export function CatalogItemCombobox({
  options,
  value,
  onSelect,
  disabled = false,
  disabledPlaceholder = "Select a vendor first.",
  placeholder = "Select an item…",
  emptyHeading = "No matches",
  emptyBody = "Try a different search.",
  isLoading = false,
  isError = false,
  onRetry,
  errorLabel = "the list",
  errorHeading,
  errorBody,
  onSearchChange,
  className,
}: CatalogItemComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = React.useMemo(
    () => options.filter((o) => matchesQuery(o, query)),
    [options, query],
  );

  function handleOpenChange(next: boolean) {
    if (disabled) return;
    setOpen(next);
    if (!next) setQuery("");
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    onSearchChange?.(next);
  }

  function handleSelect(option: CatalogItemOption) {
    onSelect(option);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          // Reflects the CURRENT SELECTION, not just the placeholder. Previously this was
          // `disabled ? disabledPlaceholder : placeholder`, so the button's accessible name never
          // changed after a choice was made — a screen-reader user heard "Select an item…" forever
          // while sighted users saw the item they had picked. Only the visible <span> below ever
          // updated. (Logged in 08.2's deferred-items.md; fixed here because the GL account picker
          // now depends on this component for a field where the selected value is the whole point.)
          aria-label={disabled ? disabledPlaceholder : (selected?.name ?? placeholder)}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
            {disabled ? disabledPlaceholder : selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false} className="overflow-hidden rounded-lg">
          <div className="flex items-center border-b px-2">
            {/*
              No `outline-none` here: it sits in the `utilities` layer and beats the `:focus-visible`
              rule in `base`, so it was silently deleting this field's only focus indicator — the
              demo's exact failure (D-38-15, "outline:none on inputs with no replacement"). The
              offset is negative because `Command`'s surface is `overflow-hidden` and a `+2px`
              outline would be clipped away. See `command-palette.tsx` for the full note.
              */}
            <Command.Input
              value={query}
              onValueChange={handleQueryChange}
              placeholder="Search…"
              className="flex h-9 w-full rounded-md bg-transparent py-2 text-sm focus-visible:outline-offset-[-2px] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto overflow-x-hidden p-1">
            {isError ? (
              /*
               * The failure, and it is deliberately LOUDER than the empty state below — the same
               * asymmetry `__tests__/components/state-character.test.tsx` measures on the
               * full-size surfaces. `--destructive` at /15 against an empty state whose only
               * decoration is `--decorative`, plus `role="alert"` where the empty branch has no
               * role at all: two facts an assistive-technology user can tell apart, not one
               * colour a sighted user might.
               *
               * 34-05 forbids softening this. No fade-in, no reduced opacity — if the animation
               * never runs the notice must already be readable, because the reader is about to
               * make a stock decision against a list the product could not read.
               */
              <div
                role="alert"
                data-testid="catalog-combobox-error"
                className="m-1 flex flex-col items-start gap-(--space-sm) rounded-md border border-destructive/30 bg-destructive/15 p-3 text-small text-destructive shadow-depth-1"
              >
                <span className="font-medium">
                  {errorHeading ?? <>Couldn&apos;t load {errorLabel}.</>}
                </span>
                <span>
                  {errorBody ?? (
                    <>
                      This list is not your data, so nothing here can be trusted. Nothing you have
                      typed has been lost.
                    </>
                  )}
                </span>
                {onRetry && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                    data-testid="catalog-combobox-retry"
                  >
                    Try again
                  </Button>
                )}
              </div>
            ) : isLoading ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <Command.Empty className="flex flex-col gap-0.5 px-2 py-4">
                <span className="text-sm font-semibold">{emptyHeading}</span>
                <div className="text-xs text-muted-foreground">{emptyBody}</div>
              </Command.Empty>
            ) : (
              filtered.map((option) => (
                <Command.Item
                  key={option.id}
                  value={option.id}
                  onSelect={() => handleSelect(option)}
                  className="flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.name}</span>
                    {(option.secondary || option.sku) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[option.secondary, option.sku].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  {typeof option.pricePaisa === "number" && (
                    <MoneyDisplay paisa={option.pricePaisa} className="shrink-0 text-xs" />
                  )}
                </Command.Item>
              ))
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

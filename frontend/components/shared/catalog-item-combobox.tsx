"use client"

import * as React from "react"
import { Command } from "cmdk"
import { ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MoneyDisplay } from "@/components/ui/money-display"

export interface CatalogItemOption {
  id: string
  name: string
  secondary?: string
  sku?: string
  pricePaisa?: number | null
}

interface CatalogItemComboboxProps {
  options: CatalogItemOption[]
  value: string | null
  onSelect: (option: CatalogItemOption) => void
  disabled?: boolean
  disabledPlaceholder?: string
  placeholder?: string
  emptyHeading?: string
  /**
   * Usually a sentence. Accepts a node so a caller whose options come from another service can
   * offer a way OUT of the empty state — a retry, a link — rather than only describing it.
   */
  emptyBody?: React.ReactNode
  isLoading?: boolean
  onSearchChange?: (query: string) => void
  className?: string
}

function matchesQuery(option: CatalogItemOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    option.name.toLowerCase().includes(q) ||
    (option.secondary?.toLowerCase().includes(q) ?? false) ||
    (option.sku?.toLowerCase().includes(q) ?? false)
  )
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
  onSearchChange,
  className,
}: CatalogItemComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const selected = options.find((o) => o.id === value) ?? null
  const filtered = React.useMemo(
    () => options.filter((o) => matchesQuery(o, query)),
    [options, query]
  )

  function handleOpenChange(next: boolean) {
    if (disabled) return
    setOpen(next)
    if (!next) setQuery("")
  }

  function handleQueryChange(next: string) {
    setQuery(next)
    onSearchChange?.(next)
  }

  function handleSelect(option: CatalogItemOption) {
    onSelect(option)
    setOpen(false)
    setQuery("")
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
            "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            className
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
            <Command.Input
              value={query}
              onValueChange={handleQueryChange}
              placeholder="Search…"
              className="flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto overflow-x-hidden p-1">
            {isLoading ? (
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
  )
}

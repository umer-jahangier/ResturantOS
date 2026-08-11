"use client";

import * as React from "react";
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectClass, type SelectOption } from "@/components/ui/select";

/**
 * The searchable counterpart to {@link Select} (D-35-01, D-35-04).
 *
 * <h2>When to use which</h2>
 *
 * {@link Select} is the default: a native control, correct for keyboard and screen readers for
 * free. Reach for this one only when the set is long enough that scanning it is work — an employee
 * list, a chart of accounts — or when the user is more likely to know the name than to recognise
 * it in a list.
 *
 * <h2>Relationship to the two bespoke pickers already in the codebase</h2>
 *
 * `components/shared/catalog-item-combobox.tsx` and `components/shared/uom-select.tsx` predate
 * this and each carry their own copy of the popover-plus-cmdk assembly. Both are now expressible
 * here. They are deliberately NOT migrated in this plan — that is a change to purchasing and
 * inventory screens, with their own regression surface, and 35-07 is the plan that proves one
 * conversion at a time. Recorded here so the duplication is visible rather than forgotten.
 *
 * <h2>The count announcement</h2>
 *
 * The result count goes into an `aria-live` region because filtering a listbox produces no
 * announcement of its own: a screen-reader user types three characters and has no idea whether
 * they narrowed 200 options to 4 or to 0.
 */

export interface ComboboxProps {
  options: readonly SelectOption[];
  value?: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Shown inside the popover above the list when the set is empty AFTER a successful load. */
  emptyLabel?: string;
  isLoading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  emptyLabel = "Nothing here yet",
  isLoading = false,
  error = false,
  onRetry,
  disabled,
  className,
  id,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // A role="combobox" must point at the listbox it controls, or assistive tech cannot follow the
  // relationship between the trigger and the options it opened.
  const listboxId = React.useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  // Same reasoning as Select: a list that FAILED to load must not render as an empty list, which
  // would read as "there are none".
  if (error) {
    return (
      <div className="flex items-center gap-2" data-slot="combobox-error">
        <span className="text-destructive text-sm">Could not load the options.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={aria["aria-describedby"]}
          disabled={disabled || isLoading}
          data-slot="combobox"
          className={cn(selectClass, "flex items-center justify-between text-left", className)}
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {isLoading ? "Loading…" : (selected?.label ?? placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            className="h-9 w-full border-b border-border px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {/* Filtering a listbox announces nothing on its own. Without this a screen-reader user
              cannot tell 4 results from 0. */}
          <div aria-live="polite" className="sr-only">
            {filtered.length === 1 ? "1 result" : `${filtered.length} results`}
          </div>
          <Command.List id={listboxId} className="max-h-60 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-center text-sm text-muted-foreground">
              {options.length === 0 ? emptyLabel : "No match"}
            </Command.Empty>
            {filtered.map((option) => (
              <Command.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                onSelect={() => {
                  onValueChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent"
              >
                <Check
                  className={cn("size-4", option.value === value ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
                {option.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };

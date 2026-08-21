"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The card-header filter strip (UI-SPEC §7.3, brief §48; demo N2).
 *
 * <h3>The defect this replaces</h3>
 *
 * `FilterBar` was named by 38-07 task 1 for twelve routes, specified in UI-SPEC §7.3, and
 * reported COMPLETE in the ROADMAP — while `grep -rn FilterBar frontend` returned **0 lines**
 * (D-38-17 records the false completion by name). What twelve back-office screens actually
 * ship is a bare native `<select>` floating above a grid, and they have already drifted apart:
 *
 * | screen | the filter it hand-rolls |
 * |---|---|
 * | `inventory/stock:184` | `className={selectClass}` — the shared string, no label |
 * | `purchasing/purchase-orders:96` | its own `h-8 rounded-lg border-input … text-small` |
 * | `finance/expenses:182` | the same string again, one role off (`text-sm`) |
 * | `finance/accounts:51` | a third string (`px-3 py-1.5`), with a visible label |
 * | `hr/attendance:94,153,165` | `w-full rounded border px-2 py-1 text-sm` — bare `rounded`, ×3 |
 *
 * Five spellings of one control, three type roles, and one G2 violation. None of them tells
 * the reader how many filters are on, and none of them offers a way back to the unfiltered
 * list — so a manager who narrowed a list on Monday reads an empty screen on Tuesday and
 * concludes the data is gone. That is the same class of defect as `QueryBoundary`'s: **the
 * interface stating something it does not know.**
 *
 * <h3>What it owns, and what it deliberately does not</h3>
 *
 * It owns the strip: an eyebrow title, the controls, the search field, the action slot, and
 * the *"N filters active · Clear all"* summary with one removable chip per active filter. It
 * does **not** own the grid. `DataGrid` already accepts `isFiltered` / `onClearFilters` and
 * renders filtered-empty as a different state from empty (UI-SPEC §8.3); a `FilterBar` that
 * wrapped the grid would have to re-implement that, and the two would drift. The caller holds
 * the filter state and hands the same values to both — which is also what keeps this
 * component on Layer 4: plain props in, callbacks out, no hook, no query, no knowledge of the
 * API.
 *
 * <h3>The `<select>` migration is NOT done here</h3>
 *
 * This renders the shared {@link Select} (D-35-01: "the one select in the app"), never a raw
 * `<select>`. Converting the twelve call sites above belongs to phase 35 and is not attempted
 * from inside a primitive — a component that lands *and* rewrites its twelve consumers is a
 * screen rebuild wearing a primitive's clothes.
 *
 * <h3>Zone — designed for `restrained`, safe on `operational` by DEFAULT (D-38-04)</h3>
 *
 * Its home is the back-office list screen (`restrained`). But a filter strip over a POS menu
 * grid or a KDS station board is an obvious future use, so it is born safe there: **no
 * `backdrop-filter`, no entrance animation, no parallax, no tilt, and no `transform` of any
 * kind** — the search icon is positioned with `inset-y-0 … flex items-center` rather than the
 * usual `top-1/2 -translate-y-1/2`, because a translate creates a containing block and G6
 * measures `containingBlockCreators: 0` on `app/pos/**`. The only motion is `transition-colors`
 * on hover, which is what `DataGrid` — the other primitive shared across all three zones —
 * already does. No richness is offered as an opt-in: a caller who wants glass composes this
 * *inside* a glass panel on an expressive surface, which keeps the enrichment at the call site
 * where the zone is actually known.
 *
 * <h3>Colour is never the only channel (D-38-13)</h3>
 *
 * An active filter is announced three ways: the count sentence, a chip carrying
 * `"Category: Dairy"` in words, and the tint. Remove the tint and the strip still reads
 * correctly in monochrome — which is the test, because teal(182) sits ΔE2000 18.68 from
 * `--success-600` and this product has already decided not to let hue carry meaning alone.
 */

/** A closed-set filter rendered as the shared {@link Select}. */
export interface FilterBarFilter {
  /** Stable within one bar. Used for the control's `id` and for React keys — not for display. */
  id: string;
  /**
   * The human name of the dimension, e.g. `"Category"`. Used three times: the control's visible
   * label, the chip prefix, and the chip's accessible name. One string, so they cannot drift.
   */
  label: string;
  /** `""` means "not filtering". Never `null` — an absent filter and an empty one are the same. */
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /**
   * The selectable "no filter" entry, prepended to `options`. Defaults to
   * `All ${label.toLowerCase()}`. It is a real option, not {@link Select}'s `placeholder` —
   * a placeholder is *disabled* by design so a required field cannot read as answered, and a
   * filter a user cannot switch off is the bug this component exists to fix.
   */
  allLabel?: string;
  isLoading?: boolean;
  /**
   * The options list failed to load. {@link Select} then renders a retry instead of an empty
   * dropdown, because an empty dropdown says "there are none" — a different, and much more
   * damaging, statement than "this did not load".
   */
  error?: boolean;
  onRetry?: () => void;
  /**
   * Forwarded verbatim to the rendered {@link Select} as `data-testid`.
   *
   * <p>Added by 38-10, and the reason is worth stating because it is the difference between a
   * primitive that can be adopted and one that cannot. The first real migration into this
   * component — the audit log's four-control filter grid — carries `data-testid="audit-filter-
   * action"` and `"audit-filter-resource"`, and those ids are load-bearing: a screen plan is not
   * permitted to rename or drop one. Without a pass-through, adopting `FilterBar` on ANY screen
   * that has test coverage means deleting that screen's coverage in the same commit, which is
   * how a shared component ends up used only on the screens nobody tests.
   */
  testId?: string;
}

export interface FilterBarSearch {
  value: string;
  onChange: (value: string) => void;
  /**
   * The accessible name, e.g. `"Search stock"`. Required: the strip shows the search field
   * without a visible label (the demo's inline right-aligned input), so this is the only name a
   * screen reader gets. Making it optional is how a control ends up announced as "edit text".
   */
  label: string;
  placeholder?: string;
}

export interface FilterBarProps {
  /**
   * The uppercase eyebrow, e.g. `"Stock levels"`. Rendered as an `<h2>` at `--text-label` and
   * used to name the region. Omit it on a screen where `PageHeader` has already said it.
   */
  title?: string;
  filters?: readonly FilterBarFilter[];
  search?: FilterBarSearch;
  /** Right-aligned, beside the search — the screen's action for this list ("New expense"). */
  actions?: React.ReactNode;
  /**
   * Controls this component has no shape for — a date range, a branch picker, a toggle group.
   * Rendered in the control row after `filters`. Anything active in here is invisible to the
   * count, which is what {@link extraActiveCount} is for.
   */
  children?: React.ReactNode;
  /**
   * How many of the `children` controls are currently narrowing the list. Defaults to 0.
   *
   * <p>Passing a non-zero value **without** `onClearAll` hides the Clear affordance rather than
   * offering one that would silently leave those filters on. A "Clear all" that does not clear
   * all is worse than none: it teaches the user the list is unfiltered when it is not.
   */
  extraActiveCount?: number;
  /**
   * Overrides the derived reset. The default resets every `filters` entry to `""` and empties
   * the search, which is correct whenever the bar can see all the state.
   */
  onClearAll?: () => void;
  /**
   * `card` (default) is the self-contained strip that sits above a `DataGrid`. `bare` drops the
   * surface, border and padding for a caller that is already inside a card and wants only the
   * strip's contents — the demo's own idiom, where the header strip is the top of a
   * zero-padding card the grid bleeds into.
   */
  variant?: "card" | "bare";
  className?: string;
}

export function FilterBar({
  title,
  filters = [],
  search,
  actions,
  children,
  extraActiveCount = 0,
  onClearAll,
  variant = "card",
  className,
}: FilterBarProps) {
  const barId = React.useId();
  const titleId = `${barId}-title`;

  const activeFilters = filters.filter((f) => f.value !== "");
  const searchActive = search !== undefined && search.value.trim() !== "";
  const activeCount = activeFilters.length + (searchActive ? 1 : 0) + extraActiveCount;

  const clearAll =
    onClearAll ??
    (() => {
      for (const filter of filters) filter.onChange("");
      search?.onChange("");
    });
  const canClearAll = onClearAll !== undefined || extraActiveCount === 0;

  // `React.Children.count` counts a BOOLEAN child: `count(false)` is 1 while `count(null)` is 0.
  // So `<FilterBar>{showBranch && <BranchPicker/>}</FilterBar>` with `showBranch === false`
  // rendered an empty, bordered 56px controls row with nothing in it. Count only children that
  // will actually paint.
  const renderableChildren = React.Children.toArray(children).filter(
    (child) => child !== null && child !== undefined && typeof child !== "boolean",
  );
  const hasControls = filters.length > 0 || renderableChildren.length > 0;
  const hasStrip = title !== undefined || search !== undefined || actions !== undefined;
  const inset = variant === "card" ? "px-5" : "px-0";

  return (
    <section
      data-slot="filter-bar"
      data-active-filters={activeCount}
      aria-labelledby={title !== undefined ? titleId : undefined}
      aria-label={title === undefined ? "Filters" : undefined}
      className={cn(
        variant === "card" && "rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
    >
      {hasStrip ? (
        <div
          data-slot="filter-bar-strip"
          className={cn(
            "flex flex-wrap items-center justify-between gap-(--space-md) py-4",
            inset,
            (hasControls || activeCount > 0) && "border-b border-border",
          )}
        >
          {title !== undefined ? (
            <h2
              id={titleId}
              className="text-label font-semibold tracking-wide uppercase text-foreground-secondary"
            >
              {title}
            </h2>
          ) : null}

          <div className="flex flex-1 flex-wrap items-center justify-end gap-(--space-sm)">
            {search ? (
              <div role="search" className="relative w-full sm:w-56">
                <label htmlFor={`${barId}-search`} className="sr-only">
                  {search.label}
                </label>
                <span
                  className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-foreground-tertiary"
                  aria-hidden="true"
                >
                  <Search className="size-3.5" />
                </span>
                <Input
                  id={`${barId}-search`}
                  type="search"
                  className="pl-8"
                  value={search.value}
                  placeholder={search.placeholder ?? "Search…"}
                  onChange={(event) => search.onChange(event.target.value)}
                />
              </div>
            ) : null}
            {actions}
          </div>
        </div>
      ) : null}

      {hasControls ? (
        <div
          data-slot="filter-bar-controls"
          className={cn(
            "flex flex-wrap items-end gap-(--space-md) py-4",
            inset,
            activeCount > 0 && "border-b border-border",
          )}
        >
          {filters.map((filter) => {
            const controlId = `${barId}-${filter.id}`;
            const labelClass =
              "text-label font-semibold tracking-wide uppercase text-foreground-tertiary";
            return (
              <div key={filter.id} className="flex min-w-40 flex-col gap-1">
                {filter.error ? (
                  <span className={labelClass}>{filter.label}</span>
                ) : (
                  <label htmlFor={controlId} className={labelClass}>
                    {filter.label}
                  </label>
                )}
                <Select
                  id={controlId}
                  data-testid={filter.testId}
                  value={filter.value}
                  onValueChange={filter.onChange}
                  isLoading={filter.isLoading}
                  error={filter.error}
                  onRetry={filter.onRetry}
                  options={[
                    { value: "", label: filter.allLabel ?? `All ${filter.label.toLowerCase()}` },
                    ...filter.options,
                  ]}
                />
              </div>
            );
          })}
          {children}
        </div>
      ) : null}

      {activeCount > 0 ? (
        <div
          data-slot="filter-bar-active"
          className={cn("flex flex-wrap items-center gap-(--space-sm) py-3", inset)}
        >
          <p className="text-small text-foreground-secondary" data-testid="filter-bar-active-count">
            {activeCount === 1 ? "1 filter active" : `${activeCount} filters active`}
          </p>

          {activeFilters.map((filter) => (
            <FilterChip
              key={filter.id}
              text={`${filter.label}: ${labelFor(filter)}`}
              onRemove={() => filter.onChange("")}
            />
          ))}
          {searchActive && search ? (
            <FilterChip text={`Search: ${search.value}`} onRemove={() => search.onChange("")} />
          ) : null}

          {canClearAll ? (
            <>
              <span aria-hidden="true" className="text-small text-foreground-tertiary">
                ·
              </span>
              <Button variant="link" size="sm" onClick={clearAll} data-testid="filter-bar-clear">
                Clear all
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The option's own label, so a chip never shows a raw id the user has not seen. */
function labelFor(filter: FilterBarFilter): string {
  return filter.options.find((o) => o.value === filter.value)?.label ?? filter.value;
}

/**
 * One removable filter (UI-SPEC §7.3: "chips, discoverable, individually removable").
 *
 * <p>The accessible name REPEATS the visible text before adding the verb — WCAG 2.2 SC 2.5.3
 * (Label in Name): a voice-control user says "Category Dairy", and a name of "Remove filter"
 * alone would leave nothing for that utterance to match.
 */
function FilterChip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`${text} — clear this filter`}
      data-slot="filter-bar-chip"
      className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-small font-medium text-primary transition-colors hover:bg-primary/20"
    >
      <span>{text}</span>
      <X className="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}

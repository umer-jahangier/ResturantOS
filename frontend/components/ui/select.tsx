"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one select in the app (D-35-01, D-35-04).
 *
 * <h2>Why this did not exist</h2>
 *
 * `components/ui/` had no `select.tsx` at all, so every screen wrote its own `<select>` with a
 * copy of the same class string — `MenuItemFormDialog` kept a module-level `selectClass` constant
 * for the purpose, and `user-form-dialog` inlined the same string again. Thirty screens, thirty
 * chances to drift.
 *
 * <h2>Why a native select and not a Radix listbox</h2>
 *
 * Deliberate, for the default case. A native `<select>` is keyboard- and screen-reader-correct for
 * free, works on touch with the platform's own picker rather than a custom overlay, and cannot get
 * stuck open inside the scroll containers this app already fights. Where a set is long or needs
 * search, {@link Combobox} is the escape hatch — not a second styling of this one.
 *
 * <h2>Options are a prop, always</h2>
 *
 * There is no built-in option list and no default. A closed set in this product is either a real
 * enum or a tenant-managed table, and both arrive from the caller. Making options required is what
 * stops a hardcoded department list being smuggled into a shared component (D-35-01).
 *
 * <h2>The three states an options list actually has</h2>
 *
 * Loading, failed, and loaded. A list that failed to load MUST NOT render as an empty dropdown,
 * because an empty dropdown reads as "there are none" — which is a different and much more
 * damaging statement than "this did not load". `error` renders a retry affordance instead.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Renders the option but refuses selection — for an inactive row kept for historical records. */
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  React.ComponentProps<"select">,
  "children" | "value" | "onChange"
> {
  options: readonly SelectOption[];
  value?: string | null;
  onValueChange?: (value: string) => void;
  /**
   * Shown as a non-selectable first entry so "not chosen yet" is distinguishable from "chose the
   * first item". Without it, a required select silently reads as already-answered.
   */
  placeholder?: string;
  isLoading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Rendered when the list loaded successfully and is genuinely empty (day one for every list). */
  emptyLabel?: string;
}

// Shared with input.tsx on purpose: an error must look identical across control types, so the
// aria-invalid treatment and the border-interactive contrast fix (UI-SPEC §3.2/§5.3, 3.77:1 light
// / 3.48:1 dark, asserted in __tests__/lib/theme/design-tokens.test.ts) are the same string.
const selectClass =
  // Same touch floor as `Input` — see globals.css. A native <select> opens a picker on tap, so a
  // missed tap here is a missed tap on the only affordance the control has.
  "touch-floor h-8 w-full min-w-0 rounded-lg border border-border-interactive bg-transparent px-2.5 py-1 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-surface-2 dark:disabled:bg-surface-3 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

function Select({
  className,
  options,
  value,
  onValueChange,
  placeholder,
  isLoading = false,
  error = false,
  onRetry,
  emptyLabel = "None yet",
  disabled,
  ...props
}: SelectProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2" data-slot="select-error">
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
    <select
      data-slot="select"
      className={cn(selectClass, className)}
      value={value ?? ""}
      disabled={disabled || isLoading}
      onChange={(event) => onValueChange?.(event.target.value)}
      {...props}
    >
      {/* `value=""` and disabled: selectable by the browser only as the initial state, never by
          the user, so a required field cannot be satisfied by "not chosen". */}
      {placeholder ? (
        <option value="" disabled>
          {isLoading ? "Loading…" : placeholder}
        </option>
      ) : null}
      {!isLoading && options.length === 0 && !placeholder ? (
        <option value="" disabled>
          {emptyLabel}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export { Select, selectClass };

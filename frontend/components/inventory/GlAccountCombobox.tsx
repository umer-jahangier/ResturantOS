"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useGlAccountSearch } from "@/lib/hooks/inventory/use-inventory";
import type { GlAccountUsage } from "@/lib/adapters/inventory.adapter";
import { ApiError } from "@/lib/errors";
import {
  CatalogItemCombobox,
  type CatalogItemOption,
} from "@/components/shared/catalog-item-combobox";
import { Button } from "@/components/ui/button";

interface GlAccountComboboxProps {
  /** Which category slot this is for — decides which account types the server offers and accepts. */
  usage: GlAccountUsage;
  /** The currently selected account CODE, or "" for "not set" (inherit from the parent category). */
  value: string;
  onChange: (code: string) => void;
  /**
   * Resolved value inherited from an ancestor, shown as the placeholder when nothing is set here.
   * Without it an untouched field reads as empty even though the category demonstrably has an
   * effective account — the manager is left to work out where it came from.
   */
  inheritedCode?: string | null;
  inheritedName?: string | null;
  inheritedFrom?: string | null;
  ariaLabel: string;
}

/** "1400 · Food Inventory", or just the code while finance-service is unreachable. */
export function formatAccount(code: string | null | undefined, name?: string | null): string {
  if (!code) return "";
  return name ? `${code} · ${name}` : code;
}

interface LookupFailure {
  heading: string;
  body: string;
  /** False when trying again cannot possibly help — offering the button would just mislead. */
  retryable: boolean;
}

/**
 * Turns a failed lookup into words that point at the right system.
 *
 * <p>This used to say "the accounting service isn't reachable right now" for EVERY failure, which
 * was wrong far more often than it was right — the first real-world sighting was a 404 from
 * inventory-service itself, with finance up and healthy the whole time. A message that names an
 * innocent service is worse than a vague one: it sends whoever reads it to check the wrong logs.
 *
 * <p>So only a genuine 503 from the finance seam names finance. The distinction the reader
 * actually needs is whether waiting will help, which is why {@code retryable} rides along.
 */
function describeFailure(error: unknown): LookupFailure {
  const status = error instanceof ApiError ? error.status : 0;
  const code = error instanceof ApiError ? error.code : "";

  // The one case where finance really is the culprit — GlAccountLookupService turns any failure
  // reaching finance-service into FINANCE_UNAVAILABLE, deliberately never into an empty list.
  if (code === "FINANCE_UNAVAILABLE" || status === 503) {
    return {
      heading: "Couldn't load accounts",
      body: "The accounting service isn't responding. Try again in a moment — everything else on this form still saves.",
      retryable: true,
    };
  }
  if (code === "PERMISSION_DENIED" || status === 403) {
    return {
      heading: "Not available to you",
      body: "Your role doesn't include browsing the chart of accounts. An administrator can set these accounts for you.",
      retryable: false,
    };
  }
  return {
    heading: "Couldn't load accounts",
    body: "Something went wrong loading the accounts list. If trying again doesn't help, report it.",
    retryable: true,
  };
}

/**
 * Searchable chart-of-accounts picker for a category's GL account slots.
 *
 * <p>Replaces three free-text inputs that accepted anything at all — `1400`, `14OO` (letter O) and
 * `banana` all saved identically, and nothing surfaced the mistake until Phase 9 posted against it.
 * Options come from the server already narrowed to active accounts of the types this slot accepts,
 * so the browser is never trusted to filter the chart, and the same rule rejects a bad value on
 * save.
 *
 * <p>Built on the shared {@link CatalogItemCombobox} rather than a second picker implementation —
 * it already handles debounced server-driven search, keyboard navigation and the empty state.
 */
export function GlAccountCombobox({
  usage,
  value,
  onChange,
  inheritedCode,
  inheritedName,
  inheritedFrom,
  ariaLabel,
}: GlAccountComboboxProps) {
  const [query, setQuery] = useState("");
  const {
    data: accounts,
    isLoading,
    isError,
    isFetching,
    error,
    refetch,
  } = useGlAccountSearch(usage, query);
  const failure = isError ? describeFailure(error) : null;

  // Keyed by CODE, not id: the category API speaks in account codes, and the code is what a
  // manager recognises. The immutable account id is what the server stores alongside it.
  const options: CatalogItemOption[] = (accounts ?? []).map((a) => ({
    id: a.code,
    name: formatAccount(a.code, a.name),
    secondary: a.accountType,
  }));

  // An account chosen earlier may not be in the current (query-filtered) page. Without this the
  // trigger would fall back to the placeholder and read as though nothing were selected.
  const selectedIsListed = options.some((o) => o.id === value);
  if (value && !selectedIsListed) {
    options.unshift({ id: value, name: value });
  }

  const placeholder = inheritedCode
    ? `Inherited${inheritedFrom ? ` from ${inheritedFrom}` : ""} — ${formatAccount(inheritedCode, inheritedName)}`
    : "Not set";

  // An empty list with an empty SEARCH means the tenant has no accounts of this type at all —
  // a different situation from a search that matched nothing, and one the manager cannot fix by
  // typing differently. Saying "no matching accounts" there describes a filter that isn't the
  // problem and sends them hunting for a spelling mistake instead of to whoever owns the chart.
  const chartIsEmpty = !failure && !isLoading && options.length === 0 && query.trim() === "";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <CatalogItemCombobox
          className="flex-1"
          options={options}
          value={value || null}
          onSelect={(option) => onChange(option.id)}
          onSearchChange={setQuery}
          isLoading={isLoading}
          placeholder={placeholder}
          /*
           * The failure moved OUT of `emptyBody` and into `isError` (plan 38-12, task 1).
           *
           * <p>The copy below is unchanged and still this file's — `describeFailure` tells a 403
           * from a 503 from a parse failure and the generic notice cannot. What changed is where
           * it is rendered: `emptyBody` is the empty slot, so this careful, correct sentence used
           * to arrive wearing the empty state's clothes — no `role="alert"`, muted-foreground on
           * a plain popover, indistinguishable at a glance from "no matching accounts". A reader
           * who cannot SEE that a failure happened has not been told one did, however well the
           * sentence is written.
           */
          isError={Boolean(failure)}
          errorHeading={failure?.heading}
          errorBody={
            failure ? (
              <>
                <span className="block">{failure.body}</span>
                {failure.retryable ? (
                  // In place, rather than making the manager close the dialog and lose a
                  // half-filled form to shake off a blip that lasted two seconds.
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    className="mt-1.5 font-medium underline underline-offset-2 disabled:opacity-50"
                  >
                    {isFetching ? "Trying…" : "Try again"}
                  </button>
                ) : null}
              </>
            ) : undefined
          }
          emptyHeading={chartIsEmpty ? "No accounts set up yet" : "No matching accounts"}
          emptyBody={
            chartIsEmpty
              ? `Your chart of accounts has no ${usage === "INVENTORY" ? "asset" : "cost or expense"} accounts yet. Someone with access to Finance needs to add them first.`
              : "Only active accounts valid for this field are listed."
          }
        />
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Clear ${ariaLabel}`}
            onClick={() => onChange("")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <p className={cn("text-xs text-muted-foreground", !inheritedCode && "sr-only")}>
        {inheritedCode && !value
          ? "Leave empty to keep inheriting."
          : "Clear this to inherit from the parent category."}
      </p>
    </div>
  );
}

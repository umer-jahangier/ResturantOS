"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerSearch } from "@/lib/hooks/crm/use-customers";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { Customer, LoyaltyTier } from "@/lib/models/crm.model";

/** Reuses the label-only legacy variants — a loyalty tier is not a workflow state. */
function tierStatus(tier: LoyaltyTier) {
  if (tier === "GOLD") return "warning" as const;
  if (tier === "SILVER") return "active" as const;
  return "inactive" as const;
}

/**
 * Customer grid with search-as-you-type. Loyalty tier and points come back on the same row, so a
 * manager can answer "what tier am I?" without opening a detail page.
 */
export function CustomerList({
  onSelect,
  selectedId,
}: {
  onSelect?: (customer: Customer) => void;
  selectedId?: string | null;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const { data: customers, isLoading } = useCustomerSearch(debounced);

  return (
    <div className="space-y-3">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search by phone or name…"
        aria-label="Search customers"
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !customers?.length ? (
        <EmptyState
          title="No customers found"
          description={
            debounced
              ? `Nothing matches "${debounced}". Try a different phone or name.`
              : "Add your first customer to start tracking loyalty."
          }
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {customers.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect?.(c)}
                aria-current={selectedId === c.id ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${
                  selectedId === c.id ? "bg-muted" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-sm text-muted-foreground tabular-nums">
                    {c.phone}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {c.tier ? <StatusBadge status={tierStatus(c.tier)} label={c.tier} /> : null}
                  <span className="text-right text-sm">
                    <span className="block tabular-nums">{c.pointsBalance} pts</span>
                    <span className="block text-muted-foreground">
                      <MoneyDisplay paisa={c.lifetimeSpendPaisa} />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCreateCustomer, useCustomerSearch } from "@/lib/hooks/crm/use-customers";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { Customer } from "@/lib/models/crm.model";

/**
 * Attaches an existing CRM customer to whatever is being created — a POS order, a house
 * account — with enrolment inline for the till (CRM-01/CRM-02).
 *
 * <p>Without this, `Order.customerId` was set in exactly one place — from the create-order request
 * — and no screen ever supplied it. So it was always null, the loyalty consumer's
 * `if (customerId == null) return;` was the only branch ever taken, and points accrued on nothing.
 *
 * <p>Enrolment happens here too: loyalty sign-up is a till conversation, and sending the cashier
 * to a back-office screen mid-order loses it. Gated on `crm.customer.manage` (changeset 048), so a
 * role without it still gets search-and-attach.
 */
export function CustomerPicker({
  value,
  onChange,
  disabled,
}: {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [newName, setNewName] = useState("");
  const debounced = useDebouncedValue(term, 250);
  const { data: results, isLoading } = useCustomerSearch(debounced, open && debounced.length > 0);
  const { permissions } = useCurrentUser();
  const canEnrol = permissions.includes("crm.customer.manage");
  const createCustomer = useCreateCustomer();

  // A search term made only of digits is a phone number, which is the one field enrolment needs.
  const looksLikePhone = /^[0-9+\-\s]{7,}$/.test(debounced.trim());

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{value.name}</span>
          <span className="block truncate text-xs tabular-nums text-muted-foreground">
            {value.phone} · {value.pointsBalance} pts
          </span>
        </span>
        {value.tier ? (
          <StatusBadge
            status={
              value.tier === "GOLD" ? "warning" : value.tier === "SILVER" ? "active" : "inactive"
            }
            label={value.tier}
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setTerm("");
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        // `size="sm"` renders 28px tall. This picker sits in the POS cart, which is touch-first
        // and where brief §16 requires 44px. Raised on the CALL SITE rather than by changing the
        // shared `sm` variant, because `sm` is used across the back office where 28px is a
        // deliberate density choice and 44px would re-space those screens (38-15 owns that
        // decision product-wide).
        className="min-h-11"
      >
        Add customer
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Phone or name…"
        aria-label="Search for a customer"
      />
      {debounced.length === 0 ? (
        <p className="text-xs text-muted-foreground">Type a phone number or name to search.</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Searching…</p>
      ) : !results?.length ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            No customer matches &ldquo;{debounced}&rdquo;.
          </p>
          {canEnrol && looksLikePhone ? (
            <div className="space-y-2 rounded-md border p-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Customer name"
                aria-label="New customer name"
              />
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!newName.trim() || createCustomer.isPending}
                onClick={() => {
                  createCustomer.mutate(
                    { phone: debounced.trim(), name: newName.trim() },
                    {
                      onSuccess: (created) => {
                        onChange(created);
                        setOpen(false);
                        setNewName("");
                      },
                    },
                  );
                }}
              >
                {createCustomer.isPending ? "Enrolling…" : `Enrol ${debounced.trim()}`}
              </Button>
              {createCustomer.isError ? (
                <p className="text-xs text-destructive">
                  Could not enrol this customer. Check the phone number is not already registered.
                </p>
              ) : null}
            </div>
          ) : canEnrol ? (
            <p className="text-xs text-muted-foreground">
              Type a full phone number to enrol a new customer.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    {c.phone}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {c.pointsBalance} pts
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

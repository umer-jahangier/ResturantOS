"use client";

import type { OrderType } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderTypeToggleProps {
  value: OrderType;
  onChange: (type: OrderType) => void;
  className?: string;
}

// D-03 (POS-18): terminal-only 3-way toggle. DELIVERY exists on the backend enum for
// other callers but is deliberately not exposed here (UI-SPEC §1 "segmented control
// Dine-in / Takeaway / Pickup"). Default is DINE_IN (pos-terminal.tsx initial state).
const OPTIONS: ReadonlyArray<{ value: OrderType; label: string }> = [
  { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "PICKUP", label: "Pickup" },
];

export function OrderTypeToggle({ value, onChange, className }: OrderTypeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Order type"
      className={cn("inline-flex items-center gap-1 rounded-lg border bg-muted p-1", className)}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          data-testid={`order-type-${opt.value.toLowerCase()}`}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

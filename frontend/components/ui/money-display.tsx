import * as React from "react";
import { formatPaisa } from "@/lib/adapters/shared";
import { cn } from "@/lib/utils";

interface MoneyDisplayProps {
  paisa: number | bigint;
  currency?: string;
  className?: string;
  /**
   * Extra decimal places, for a RATE rather than an amount. A per-gram cost of 6.2 paisa is
   * Rs 0.062 — it reads as Rs 0.06 at the usual two places, and anything cheaper reads as Rs 0.00,
   * which is exactly the "this is free" impression a unit cost must never give. Pass 4 on a
   * per-unit cost column; leave it alone for money.
   */
  maxFractionDigits?: number;
}

/**
 * Renders a paisa amount. The conversion itself lives in {@link formatPaisa} — one site shared
 * with `toMoney` and pinned against the JVM formatter by a vector file both stacks read
 * (37-01). This component owns the markup and nothing about the number.
 */
function MoneyDisplay({
  paisa,
  currency = "PKR",
  className,
  maxFractionDigits = 2,
}: MoneyDisplayProps) {
  const formatted = formatPaisa(paisa, { maxFractionDigits, currency });

  return <span className={cn("tabular-nums font-medium", className)}>{formatted}</span>;
}

export { MoneyDisplay };

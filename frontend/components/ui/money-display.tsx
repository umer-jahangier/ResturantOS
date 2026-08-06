import * as React from "react";
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

function MoneyDisplay({
  paisa,
  currency = "PKR",
  className,
  maxFractionDigits = 2,
}: MoneyDisplayProps) {
  // Amounts are integral and can be very large, so they keep the exact BigInt path. Rates are not
  // integral — since V12 a per-stock-unit cost is NUMERIC(18,4) — and BigInt() throws outright on
  // a fractional value, which would have taken out every screen showing a unit cost.
  const isWhole = typeof paisa === "bigint" || Number.isInteger(paisa);
  let rupees: number;
  if (isWhole) {
    const paisaBig = BigInt(paisa);
    const hundred = BigInt(100);
    rupees = Number(paisaBig / hundred) + Number(paisaBig % hundred) / 100;
  } else {
    rupees = Number(paisa) / 100;
  }

  const formatted = new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, maxFractionDigits),
  }).format(rupees);

  return <span className={cn("tabular-nums font-medium", className)}>{formatted}</span>;
}

export { MoneyDisplay };

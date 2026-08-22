"use client";

import { ArrowDownLeft, ArrowUpRight, Receipt, ShoppingCart } from "lucide-react";

import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { ReportDataNotes } from "@/components/reporting/ReportDataNotes";
import { formatNumber } from "@/lib/format/locale";
import type { FbrTaxSummary } from "@/lib/models/reporting.model";

interface FbrTaxSummaryCardProps {
  summary: FbrTaxSummary | undefined;
  isLoading: boolean;
}

/**
 * FBR (Federal Board of Revenue) Tax Summary — output tax vs input tax vs net payable for a
 * period. An internal bookkeeping figure, not an e-filing submission.
 *
 * <h3>Re-typeset onto the contract (N12)</h3>
 *
 * This was the single worst type-scale offender on the reporting surfaces — **sixteen**
 * off-contract classes in ninety lines, mixing `text-xs`, `text-sm`, `text-base`, `text-lg` and
 * `text-2xl` in one card, so five sizes carried four meanings and the headline figure (the whole
 * point of the screen) was `text-2xl` where the contract's display role is 30px. The five money
 * figures are `StatTile`s now, which is the product's one KPI primitive and the same thing
 * `/app/dashboard` uses for exactly this kind of number.
 *
 * <h3>A refundable credit is a LABEL change, not a minus sign</h3>
 *
 * A negative `netPayablePaisa` is a legitimate refundable input-tax credit — 12-05 is explicit
 * that it is never clamped, and `apiFbrTaxSummarySchema` deliberately omits `.nonnegative()` so
 * it survives the parse. `−Rs 150.00` under a heading reading "Net payable" reads as a broken
 * screen, so the sign is spent on the WORDS: the tile is titled "Refundable input-tax credit",
 * the magnitude is rendered positive, and a sentence beneath says why. Three channels, none of
 * them a glyph a reader has to notice.
 *
 * <h3>`dataNotes` goes through the shared block</h3>
 *
 * It used to be `summary.dataNotes.join(" ")` inside a muted strip — two caveats concatenated
 * into one run-on line, in the quietest type in the card. It is {@link ReportDataNotes} now, the
 * same component the named reports use, so a caveat looks the same wherever it appears and there
 * is one implementation to keep honest.
 */
export function FbrTaxSummaryCard({ summary, isLoading }: FbrTaxSummaryCardProps) {
  if (isLoading) {
    return (
      <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  // The caller wraps this in a `QueryBoundary`, which owns the error and pending states. This
  // component is not able to tell a 503 from "not asked yet" and must not draw a conclusion.
  if (!summary) return null;

  const isRefundable = summary.netPayablePaisa < 0;
  const netPayableAbs = isRefundable ? -summary.netPayablePaisa : summary.netPayablePaisa;

  return (
    <div className="space-y-(--space-md)">
      <ReportDataNotes notes={summary.dataNotes} />

      <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={isRefundable ? "Refundable input-tax credit" : "Net payable"}
          value={<MoneyDisplay paisa={netPayableAbs} />}
          icon={isRefundable ? ArrowDownLeft : ArrowUpRight}
          accent="primary"
        />
        <StatTile
          label="Taxable sales"
          value={<MoneyDisplay paisa={summary.taxableSalesPaisa} />}
          icon={Receipt}
        />
        <StatTile label="Output tax" value={<MoneyDisplay paisa={summary.outputTaxPaisa} />} />
        <StatTile
          label="Taxable purchases"
          value={<MoneyDisplay paisa={summary.taxablePurchasesPaisa} />}
          icon={ShoppingCart}
        />
        <StatTile label="Input tax" value={<MoneyDisplay paisa={summary.inputTaxPaisa} />} />
      </div>

      {isRefundable && (
        <p className="text-small text-foreground-secondary">
          Input tax exceeded output tax for this period — this is a credit, not an amount owed.
        </p>
      )}

      <p className="text-small text-foreground-tertiary tabular-nums">
        {formatNumber(summary.salesOrderCount)} sales order
        {summary.salesOrderCount === 1 ? "" : "s"} · {formatNumber(summary.purchaseInvoiceCount)}{" "}
        purchase invoice
        {summary.purchaseInvoiceCount === 1 ? "" : "s"} · computed in{" "}
        {formatNumber(summary.durationMs)} ms
      </p>
    </div>
  );
}

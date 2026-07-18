"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";
import type { FbrTaxSummary } from "@/lib/models/reporting.model";

interface FbrTaxSummaryCardProps {
  summary: FbrTaxSummary | undefined;
  isLoading: boolean;
}

/**
 * FBR (Federal Board of Revenue) Tax Summary — output tax vs input tax vs net payable for a
 * period. This is an internal bookkeeping figure, not an e-filing submission.
 */
export function FbrTaxSummaryCard({ summary, isLoading }: FbrTaxSummaryCardProps) {
  if (isLoading) {
    return (
      <div className="space-y-4 rounded-lg border border-border p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  // A negative netPayablePaisa is a legitimate refundable input-tax credit, never a bug — it must
  // never render as "-PKR 1,234.00" under a "Net Payable" heading (that reads as broken).
  const isRefundable = summary.netPayablePaisa < 0;
  const netPayableAbs = isRefundable ? -summary.netPayablePaisa : summary.netPayablePaisa;

  return (
    <div className="space-y-6 rounded-lg border border-border p-6">
      <div>
        <h2 className="text-lg font-semibold">{summary.branchName}</h2>
        {summary.ntn || summary.fbrStrn ? (
          <p className="text-sm text-muted-foreground">
            {summary.ntn ? `NTN ${summary.ntn}` : null}
            {summary.ntn && summary.fbrStrn ? " · " : null}
            {summary.fbrStrn ? `FBR STRN ${summary.fbrStrn}` : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Branch tax registration unavailable — figures below are unaffected.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {summary.periodFrom} to {summary.periodTo}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Taxable sales</p>
          <MoneyDisplay paisa={summary.taxableSalesPaisa} className="text-base" />
          <p className="text-sm text-muted-foreground">
            Output tax: <MoneyDisplay paisa={summary.outputTaxPaisa} />
          </p>
          <p className="text-xs text-muted-foreground">{summary.salesOrderCount} orders</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Taxable purchases</p>
          <MoneyDisplay paisa={summary.taxablePurchasesPaisa} className="text-base" />
          <p className="text-sm text-muted-foreground">
            Input tax: <MoneyDisplay paisa={summary.inputTaxPaisa} />
          </p>
          <p className="text-xs text-muted-foreground">{summary.purchaseInvoiceCount} invoices</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {isRefundable ? "Refundable input-tax credit" : "Net Payable"}
        </p>
        <MoneyDisplay paisa={netPayableAbs} className="text-2xl" />
        {isRefundable && (
          <p className="mt-1 text-xs text-muted-foreground">
            Input tax exceeded output tax for this period — this is a credit, not an amount owed.
          </p>
        )}
      </div>

      {summary.dataNotes.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {summary.dataNotes.join(" ")}
        </div>
      )}
    </div>
  );
}

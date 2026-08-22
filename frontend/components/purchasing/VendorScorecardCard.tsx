"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import type { VendorScorecard } from "@/lib/adapters/purchasing.adapter";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-label text-muted-foreground">{label}</div>
      <div className="text-h2 font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * PUR-05: vendor scorecard — on-time delivery %, fill rate %, price variance % (all three kept
 * visible together, per UAT test 15) plus total spend, for whichever vendor is selected on the page.
 */
export function VendorScorecardCard({
  vendorId,
  scorecard,
  isLoading,
  isError,
  error,
  onRetry,
  isRetrying,
}: {
  vendorId: string;
  scorecard: VendorScorecard | undefined;
  isLoading?: boolean;
  /**
   * Whether the scorecard request FAILED — required, not optional-by-omission.
   *
   * <p>Without it this card fell through to *"No scorecard data for this vendor yet"*, which is
   * the GA-001 sentence with a different noun: a buyer whose purchasing service was down was told
   * the vendor had no delivery history, and the honest reading of that is "this supplier has
   * never delivered late". The three percentages on this card are what a manager renegotiates a
   * contract on. They may not be replaced by a confident absence.
   */
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  if (!vendorId) {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
          Vendor scorecard
        </h2>
        <p className="mt-3 text-small text-muted-foreground">
          Select a vendor to see its scorecard.
        </p>
      </div>
    );
  }

  // Error before loading and before empty. A failed request has no trustworthy `scorecard`, so
  // "does this vendor have one yet?" is not a question that can honestly be asked.
  if (isError) {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
          Vendor scorecard
        </h2>
        <QueryErrorNotice
          className="mt-3"
          what="this vendor's scorecard"
          moduleLabel="Purchasing"
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      </div>
    );
  }

  if (isLoading && !scorecard) {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
          Vendor scorecard
        </h2>
        {/*
          A skeleton matched to the four metrics below, not the words "Loading scorecard…".
          UI-SPEC §24: the placeholder occupies the box the content will, so the card does not
          change height when the figures land.
        */}
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-24 max-w-full" />
              <Skeleton className="h-6 w-16 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!scorecard) {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
          Vendor scorecard
        </h2>
        <p className="mt-3 text-small text-muted-foreground">
          No scorecard data for this vendor yet.
        </p>
      </div>
    );
  }

  const priceVarianceSign = scorecard.priceVariancePct >= 0 ? "+" : "";
  return (
    <div className="rounded-lg border p-4">
      <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
        Vendor scorecard
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="On-time delivery" value={`${scorecard.onTimeDeliveryPct.toFixed(1)}%`} />
        <Metric label="Fill rate" value={`${scorecard.fillRatePct.toFixed(1)}%`} />
        <Metric
          label="Price variance"
          value={`${priceVarianceSign}${scorecard.priceVariancePct.toFixed(1)}%`}
        />
        <div>
          <div className="text-label text-muted-foreground">Total spend</div>
          <div className="text-h2 font-semibold">
            <MoneyDisplay paisa={scorecard.totalSpendPaisa} />
          </div>
        </div>
      </div>
    </div>
  );
}

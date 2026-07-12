"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import type { VendorScorecard } from "@/lib/adapters/purchasing.adapter";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
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
}: {
  vendorId: string;
  scorecard: VendorScorecard | undefined;
  isLoading?: boolean;
}) {
  if (!vendorId) {
    return (
      <div className="rounded border p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Vendor scorecard</h2>
        <p className="mt-3 text-sm text-muted-foreground">Select a vendor to see its scorecard.</p>
      </div>
    );
  }

  if (isLoading && !scorecard) {
    return (
      <div className="rounded border p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Vendor scorecard</h2>
        <p className="mt-3 text-sm text-muted-foreground">Loading scorecard…</p>
      </div>
    );
  }

  if (!scorecard) {
    return (
      <div className="rounded border p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Vendor scorecard</h2>
        <p className="mt-3 text-sm text-muted-foreground">No scorecard data for this vendor yet.</p>
      </div>
    );
  }

  const priceVarianceSign = scorecard.priceVariancePct >= 0 ? "+" : "";
  return (
    <div className="rounded border p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Vendor scorecard</h2>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="On-time delivery" value={`${scorecard.onTimeDeliveryPct.toFixed(1)}%`} />
        <Metric label="Fill rate" value={`${scorecard.fillRatePct.toFixed(1)}%`} />
        <Metric
          label="Price variance"
          value={`${priceVarianceSign}${scorecard.priceVariancePct.toFixed(1)}%`}
        />
        <div>
          <div className="text-xs text-muted-foreground">Total spend</div>
          <div className="text-lg font-semibold">
            <MoneyDisplay paisa={scorecard.totalSpendPaisa} />
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useSpendAnalytics, useVendorScorecard, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { SpendAnalyticsTable } from "@/components/purchasing/SpendAnalyticsTable";
import { VendorScorecardCard } from "@/components/purchasing/VendorScorecardCard";
import { PeriodPicker, thisMonthRange, type PeriodRange } from "@/components/purchasing/PeriodPicker";
import type { SpendAnalytics, VendorScorecard } from "@/lib/adapters/purchasing.adapter";

/**
 * `use-purchasing.ts` (owned by 10-12/10-13) does not expose `placeholderData`, so the
 * "keep previous data visible while refetching" behaviour is done here at the page level
 * via the React-recommended "store info from previous render" pattern (setState during
 * render, not inside a useEffect) rather than editing the shared hook.
 */
function useKeepPreviousData<T>(latest: T | undefined): T | undefined {
  const [shown, setShown] = useState(latest);
  if (latest !== undefined && latest !== shown) {
    setShown(latest);
  }
  return shown;
}

export default function PurchasingAnalyticsPage() {
  const { branchId } = useCurrentUser();
  const { data: vendors } = useVendors();
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());

  const { data: spendData, isLoading: spendLoading } = useSpendAnalytics(branchId, period.from, period.to);
  const spend = useKeepPreviousData<SpendAnalytics>(spendData);

  const firstVendorId = vendors?.[0]?.id ?? "";
  const { data: scorecardData, isLoading: scorecardLoading } = useVendorScorecard(firstVendorId, branchId);
  const scorecard = useKeepPreviousData<VendorScorecard>(scorecardData);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Vendor analytics</h1>
        <p className="text-sm text-muted-foreground">
          Spend by vendor and category, {period.from} to {period.to}, vs the prior period.
        </p>
      </div>

      <PeriodPicker value={period} onChange={setPeriod} />

      {scorecardLoading && !scorecard ? (
        <p>Loading scorecard…</p>
      ) : scorecard ? (
        <VendorScorecardCard scorecard={scorecard} />
      ) : null}

      {spendLoading && !spend ? (
        <p>Loading spend analytics…</p>
      ) : spend ? (
        <div className="space-y-8">
          <p className="text-xs text-muted-foreground">
            vs {spend.compareFrom} – {spend.compareTo}
          </p>
          <SpendAnalyticsTable title="By vendor" buckets={spend.byVendor} />
          <SpendAnalyticsTable title="By category" buckets={spend.byCategory} />
        </div>
      ) : null}
    </div>
  );
}

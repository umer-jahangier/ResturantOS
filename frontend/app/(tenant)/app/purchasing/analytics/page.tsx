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
  const [vendorId, setVendorId] = useState<string>("");

  const { data: spendData, isLoading: spendLoading } = useSpendAnalytics(branchId, period.from, period.to);
  const spend = useKeepPreviousData<SpendAnalytics>(spendData);

  // Default to the first vendor once vendors load, so the page isn't empty on first render,
  // but never override an explicit user selection.
  const selectedVendorId = vendorId || vendors?.[0]?.id || "";
  const { data: scorecardData, isLoading: scorecardLoading } = useVendorScorecard(
    selectedVendorId,
    branchId,
  );
  const scorecard = useKeepPreviousData<VendorScorecard>(scorecardData);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Vendor analytics</h1>
        <p className="text-sm text-muted-foreground">
          Spend by vendor and category, {period.from} to {period.to}, vs the prior period.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <PeriodPicker value={period} onChange={setPeriod} />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Vendor
          <select
            aria-label="Scorecard vendor"
            value={selectedVendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {(vendors ?? []).map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <VendorScorecardCard vendorId={selectedVendorId} scorecard={scorecard} isLoading={scorecardLoading} />

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

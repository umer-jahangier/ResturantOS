"use client";

import { useMemo } from "react";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useSpendAnalytics, useVendorScorecard, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { SpendAnalyticsTable } from "@/components/purchasing/SpendAnalyticsTable";
import { VendorScorecardCard } from "@/components/purchasing/VendorScorecardCard";

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function PurchasingAnalyticsPage() {
  const { branchId } = useCurrentUser();
  const { data: vendors } = useVendors();
  const { from, to } = useMemo(() => currentMonthRange(), []);

  const { data: spend, isLoading: spendLoading } = useSpendAnalytics(branchId, from, to);

  const firstVendorId = vendors?.[0]?.id ?? "";
  const { data: scorecard, isLoading: scorecardLoading } = useVendorScorecard(firstVendorId, branchId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Vendor analytics</h1>
        <p className="text-sm text-muted-foreground">
          Spend by vendor and category, {from} to {to}, vs the prior period.
        </p>
      </div>

      {scorecardLoading ? (
        <p>Loading scorecard…</p>
      ) : scorecard ? (
        <VendorScorecardCard scorecard={scorecard} />
      ) : null}

      {spendLoading ? (
        <p>Loading spend analytics…</p>
      ) : spend ? (
        <div className="space-y-8">
          <SpendAnalyticsTable title="By vendor" buckets={spend.byVendor} />
          <SpendAnalyticsTable title="By category" buckets={spend.byCategory} />
        </div>
      ) : null}
    </div>
  );
}

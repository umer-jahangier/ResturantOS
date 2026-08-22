"use client";

import { useState } from "react";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  useSpendAnalytics,
  useVendorScorecard,
  useVendors,
} from "@/lib/hooks/purchasing/use-purchasing";
import { SpendAnalyticsTable } from "@/components/purchasing/SpendAnalyticsTable";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { VendorScorecardCard } from "@/components/purchasing/VendorScorecardCard";
import {
  PeriodPicker,
  thisMonthRange,
  type PeriodRange,
} from "@/components/purchasing/PeriodPicker";
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

/**
 * `/app/purchasing/analytics` — three independent queries, three independent failures.
 *
 * <h3>Why there is no single boundary around this page (UI-SPEC §8.1.1)</h3>
 *
 * The vendor list, the scorecard and the spend breakdown are separate requests to separate
 * endpoints, and this screen used to destructure `isLoading` from two of them and `isError` from
 * none. A failing scorecard therefore rendered "No scorecard data for this vendor yet" and a
 * failing spend request rendered nothing at all — the page looked like a quiet month rather than
 * a broken service, which is GA-001 wearing a different noun.
 *
 * <p>Wrapping the whole page in one boundary would fix the lie and introduce a smaller one: a
 * vendor list that loaded fine would be thrown away because the scorecard did not, and a buyer
 * who could still read this month's spend would be shown a full-page failure instead. So each
 * region carries its own, and each names what IT could not load. A failure is scoped to the
 * region that is genuinely unavailable and no further.
 */
export default function PurchasingAnalyticsPage() {
  const { branchId } = useCurrentUser();
  const vendorsQuery = useVendors();
  const { data: vendors } = vendorsQuery;
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());
  const [vendorId, setVendorId] = useState<string>("");

  const spendQuery = useSpendAnalytics(branchId, period.from, period.to);
  const { data: spendData, isLoading: spendLoading } = spendQuery;
  const spend = useKeepPreviousData<SpendAnalytics>(spendData);

  // Default to the first vendor once vendors load, so the page isn't empty on first render,
  // but never override an explicit user selection.
  const selectedVendorId = vendorId || vendors?.[0]?.id || "";
  const scorecardQuery = useVendorScorecard(selectedVendorId, branchId);
  const { data: scorecardData, isLoading: scorecardLoading } = scorecardQuery;
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
            disabled={vendorsQuery.isError}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/*
              An empty `<select>` is the control's own version of the empty-state lie: a buyer
              whose vendor list failed to load sees a picker with no suppliers in it and concludes
              there are none. The option below says which it is, and the notice underneath offers
              the retry — the control keeps its shape either way so the row does not reflow.
            */}
            {vendorsQuery.isError && <option value="">Vendor list unavailable</option>}
            {(vendors ?? []).map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {vendorsQuery.isError && (
        <QueryErrorNotice
          what="the vendor list"
          moduleLabel="Purchasing"
          error={vendorsQuery.error}
          onRetry={() => void vendorsQuery.refetch()}
          isRetrying={vendorsQuery.isFetching}
        />
      )}

      <VendorScorecardCard
        vendorId={selectedVendorId}
        scorecard={scorecard}
        isLoading={scorecardLoading}
        // Stale-but-real figures outrank a failed refetch: if a scorecard is already on screen the
        // reader is looking at numbers that were true, and blanking them for a transient refetch
        // failure removes information rather than adding it. A first load that fails has nothing
        // to keep, and says so.
        isError={scorecardQuery.isError && scorecard === undefined}
        error={scorecardQuery.error}
        onRetry={() => void scorecardQuery.refetch()}
        isRetrying={scorecardQuery.isFetching}
      />

      {spendQuery.isError && spend === undefined ? (
        <QueryErrorNotice
          what="the spend breakdown"
          moduleLabel="Purchasing"
          error={spendQuery.error}
          onRetry={() => void spendQuery.refetch()}
          isRetrying={spendQuery.isFetching}
        />
      ) : spendLoading && !spend ? (
        <SpendAnalyticsSkeleton />
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

/**
 * The spend region's placeholder, matched to the two tables it replaces.
 *
 * <p>It was the sentence "Loading spend analytics…" — which is a spinner made of words: it
 * reserves none of the space the content will take, so the page jumps by two table-heights when
 * the request lands, and it is the same picture whether one table is coming or two. UI-SPEC §24
 * asks a placeholder to be the shape of what is coming.
 */
function SpendAnalyticsSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading spend analytics">
      <Skeleton className="h-4 w-56 max-w-full" />
      {[0, 1].map((table) => (
        <div key={table} className="space-y-2">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { FbrTaxSummaryCard } from "@/components/reporting/FbrTaxSummaryCard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useFbrTaxSummary } from "@/lib/hooks/reporting/use-reports";
import { thisMonthRange, type PeriodRange } from "@/components/purchasing/PeriodPicker";

function FbrTaxSummaryPageInner() {
  const { branchId } = useCurrentUser();
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());

  // netPayablePaisa (output tax − input tax, unclamped) is the headline figure this page exists
  // to surface — see FbrTaxSummaryCard for the refundable-credit rendering rule.
  const { data: summary, isLoading } = useFbrTaxSummary({
    branchId,
    from: period.from,
    to: period.to,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/reports" className="text-sm text-muted-foreground hover:underline">
          ← All reports
        </Link>
        <h1 className="text-xl font-semibold">FBR Tax Summary</h1>
        <p className="text-sm text-muted-foreground">
          Output tax vs input tax vs net payable — internal bookkeeping figures, not an FBR/IRIS
          e-filing submission.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            aria-label="FBR period from"
            value={period.from}
            max={period.to}
            onChange={(e) => setPeriod({ from: e.target.value, to: period.to })}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            aria-label="FBR period to"
            value={period.to}
            min={period.from}
            onChange={(e) => setPeriod({ from: period.from, to: e.target.value })}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      </div>

      <FbrTaxSummaryCard summary={summary} isLoading={isLoading} />
    </div>
  );
}

export default function FbrTaxSummaryPage() {
  return (
    <PermissionGuard require="reporting.report.fbr" fallback={<AccessDenied />}>
      <div className="p-6">
        <FbrTaxSummaryPageInner />
      </div>
    </PermissionGuard>
  );
}

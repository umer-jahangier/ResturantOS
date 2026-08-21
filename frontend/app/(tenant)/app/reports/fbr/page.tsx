"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { FbrTaxSummaryCard } from "@/components/reporting/FbrTaxSummaryCard";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useFbrTaxSummary } from "@/lib/hooks/reporting/use-reports";
import { thisMonthRange, type PeriodRange } from "@/components/purchasing/PeriodPicker";
import type { FbrTaxSummary } from "@/lib/models/reporting.model";

/**
 * The `·`-separated subtitle: who these figures belong to, under what registration, for what
 * period. The registration line is the one place this screen can honestly be incomplete —
 * `ntn`/`fbrStrn` come from a user-service lookup that can fail while the tax figures are
 * perfectly sound — so its absence is stated rather than left as a gap the reader has to notice.
 */
function fbrMeta(summary: FbrTaxSummary): string {
  const registration = [
    summary.ntn ? `NTN ${summary.ntn}` : null,
    summary.fbrStrn ? `FBR STRN ${summary.fbrStrn}` : null,
  ].filter(Boolean);
  return [
    summary.branchName,
    registration.length > 0
      ? registration.join(" · ")
      : "Branch tax registration unavailable — the figures below are unaffected",
    `${summary.periodFrom} to ${summary.periodTo}`,
  ].join(" · ");
}

function FbrTaxSummaryPageInner() {
  const { branchId } = useCurrentUser();
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());

  // netPayablePaisa (output tax − input tax, unclamped) is the headline figure this page exists
  // to surface — see FbrTaxSummaryCard for the refundable-credit rendering rule.
  const query = useFbrTaxSummary({ branchId, from: period.from, to: period.to });

  return (
    <>
      <div>
        <Link
          href="/app/reports"
          className="inline-flex items-center gap-1 text-small font-medium text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          All reports
        </Link>
      </div>

      <PageHeader
        title="FBR Tax Summary"
        description="Output tax vs input tax vs net payable — internal bookkeeping figures, not an FBR/IRIS e-filing submission."
        meta={query.data ? fbrMeta(query.data) : undefined}
      />

      <FilterBar title="Tax period">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="fbr-period-from"
            className="text-label font-semibold tracking-wide text-foreground-tertiary uppercase"
          >
            From
          </label>
          <Input
            id="fbr-period-from"
            type="date"
            aria-label="FBR period from"
            value={period.from}
            max={period.to}
            onChange={(e) => setPeriod({ from: e.target.value, to: period.to })}
            className="w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="fbr-period-to"
            className="text-label font-semibold tracking-wide text-foreground-tertiary uppercase"
          >
            To
          </label>
          <Input
            id="fbr-period-to"
            type="date"
            aria-label="FBR period to"
            value={period.to}
            min={period.from}
            onChange={(e) => setPeriod({ from: period.from, to: e.target.value })}
            className="w-44"
          />
        </div>
      </FilterBar>

      {/*
       * F15, in the one place on the reporting surfaces where it was still live. `FbrTaxSummaryCard`
       * renders `null` for an undefined summary, so a 503 from reporting-service and a request
       * that has not been made were the SAME blank rectangle under an operable date form — an
       * accountant would read that as "this branch owed no tax this month". The boundary makes
       * the failure a sentence.
       */}
      <QueryBoundary
        query={query}
        what="the FBR tax summary"
        moduleLabel="Reporting"
        stillWorks="The rest of the product is unaffected — orders, the till and the kitchen board keep working."
        loading={<FbrTaxSummaryCard summary={undefined} isLoading />}
      >
        <FbrTaxSummaryCard summary={query.data} isLoading={false} />
      </QueryBoundary>
    </>
  );
}

export default function FbrTaxSummaryPage() {
  return (
    <PermissionGuard require="reporting.report.fbr" fallback={<AccessDenied />}>
      <PageBody className="space-y-(--space-lg)">
        <FbrTaxSummaryPageInner />
      </PageBody>
    </PermissionGuard>
  );
}

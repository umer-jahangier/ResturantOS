"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { ReportTable } from "@/components/reporting/ReportTable";
import { ReportVisual } from "@/components/reporting/ReportVisual";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useReports, useRunReport } from "@/lib/hooks/reporting/use-reports";
import { formatNumber } from "@/lib/format/locale";
import { thisMonthRange, type PeriodRange } from "@/components/purchasing/PeriodPicker";
import type { ReportResult } from "@/lib/models/reporting.model";

interface ReportRunPageProps {
  params: Promise<{ code: string }>;
}

/**
 * The state this screen exists to stop being invisible (F15).
 *
 * `/app/reports/audit` — a URL nothing in the product ever links to — used to render
 * *"← All reports / audit / From To"*: a heading typed out of the URL segment, an operable
 * date-range form, and beneath it nothing at all. The run request behind it answered
 * **404 Report not found** (twice, after a retry) and the reader was told none of it, because
 * `ReportTable` renders `null` whenever `result` is undefined and cannot tell "the request
 * failed" from "the report has not run yet". An owner reading that screen concludes the audit
 * report exists and their restaurant had no activity — which is the GA-001 lie in a new place.
 *
 * So the code is checked against the catalog BEFORE anything report-shaped is drawn, and the
 * three answers are kept distinct:
 *
 *  - the catalog has not answered yet → a skeleton, and no heading invented from the URL;
 *  - the catalog FAILED → "couldn't load the report catalog", never "no such report". A
 *    reporting-service outage must not be reported to the user as a report that does not exist;
 *  - the catalog answered and does not hold this code → this state, which says so plainly and
 *    hands back the one link that helps.
 *
 * The run query is `enabled` only once a definition is in hand, so an unknown code no longer
 * posts a doomed request (nor React Query's retry of it) at reporting-service at all.
 */
function UnknownReport({ code }: { code: string }) {
  return (
    <div data-testid="report-not-found" className="space-y-(--space-md)">
      <EmptyState
        icon={FileQuestion}
        title="This report doesn't exist"
        description={`No report is registered under the code "${code}". The link may be out of date, or the code mistyped — nothing has gone wrong with your data.`}
      />
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link href="/app/reports">Back to all reports</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The `·`-separated subtitle, and the rule it has to obey.
 *
 * <p>Every count in it is derived from `result.rows` — the SAME array `DataGrid` renders and
 * counts in its own footer — so the header and the grid cannot disagree. Deriving the row count
 * from the server's `rowCount` field instead would look identical and would be a second source
 * of truth for one number; when the two DO disagree that is a real defect in the result, and it
 * is reported here rather than quietly resolved in favour of whichever one was read first.
 */
function reportMeta(result: ReportResult, period: PeriodRange): string {
  const rows = result.rows.length;
  const parts = [
    `${formatNumber(rows)} row${rows === 1 ? "" : "s"}`,
    `${period.from} to ${period.to}`,
    `ran in ${formatNumber(result.durationMs)} ms`,
  ];
  if (result.rowCount !== rows) {
    parts.push(
      `server reported ${formatNumber(result.rowCount)} — this grid shows ${formatNumber(rows)}`,
    );
  }
  return parts.join(" · ");
}

function ReportRunner({ code }: { code: string }) {
  const { branchId } = useCurrentUser();
  const catalog = useReports();
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());

  const definition = catalog.data?.find((r) => r.code === code);

  // Nothing is run until the catalog has CONFIRMED the code. `enabled` is what keeps an unknown
  // code from firing a request that can only 404, and what keeps the run's own error state
  // meaningful — a failure below now always means a real report failed to run.
  const run = useRunReport(
    code,
    { branchId, from: period.from, to: period.to },
    { enabled: Boolean(definition) },
  );

  // Never the URL segment. Until the catalog resolves, the product does not know what this
  // report is called and must not pretend a slug is a title.
  const heading = definition ? definition.title : catalog.isSuccess ? "Report not found" : "Report";

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
        title={heading}
        description={
          definition ? `${definition.category} · ${definition.columns.length} columns` : undefined
        }
        meta={run.data ? reportMeta(run.data, period) : undefined}
      />

      {/*
       * Error → loading → unknown-code → the report itself, in that order and enforced by the
       * component rather than by three ifs a later edit can reorder. `isEmpty` here means "the
       * catalog resolved and does not contain this code", which is only an honest question to
       * ask once the catalog has actually resolved without error.
       */}
      <QueryBoundary
        query={catalog}
        what="the report catalog"
        moduleLabel="Reporting"
        isEmpty={!definition}
        empty={<UnknownReport code={code} />}
        loading={
          <div className="space-y-(--space-lg)">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        {definition && (
          <div className="space-y-(--space-lg)">
            <FilterBar title="Report period">
              {/*
               * The visible `<label>` says "From"; the `aria-label` says "Report period from",
               * which is the accessible name a screen-reader user hears out of context and the
               * name this screen's coverage has always addressed the field by. It CONTAINS the
               * visible word, so WCAG 2.2 SC 2.5.3 (Label in Name) still holds and a voice-control
               * user saying "From" still matches.
               */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="report-period-from"
                  className="text-label font-semibold tracking-wide text-foreground-tertiary uppercase"
                >
                  From
                </label>
                <Input
                  id="report-period-from"
                  type="date"
                  aria-label="Report period from"
                  value={period.from}
                  max={period.to}
                  onChange={(e) => setPeriod({ from: e.target.value, to: period.to })}
                  className="w-44"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="report-period-to"
                  className="text-label font-semibold tracking-wide text-foreground-tertiary uppercase"
                >
                  To
                </label>
                <Input
                  id="report-period-to"
                  type="date"
                  aria-label="Report period to"
                  value={period.to}
                  min={period.from}
                  onChange={(e) => setPeriod({ from: period.from, to: e.target.value })}
                  className="w-44"
                />
              </div>
            </FilterBar>

            {/*
             * A run that fails is announced. `ReportTable` alone cannot do this: it takes
             * `result | undefined` and renders `null` for undefined, so a 404, a 503 and
             * "not started" are one indistinguishable blank.
             */}
            <QueryBoundary
              query={run}
              what={`the ${definition.title} report`}
              moduleLabel="Reporting"
              stillWorks="The rest of the product is unaffected — orders, the till and the kitchen board keep working."
              loading={<ReportTable result={undefined} isLoading />}
            >
              <div className="space-y-(--space-lg)">
                {run.data && <ReportVisual result={run.data} />}
                <ReportTable result={run.data} isLoading={false} />
              </div>
            </QueryBoundary>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

export default function ReportRunPage({ params }: ReportRunPageProps) {
  const { code } = use(params);
  return (
    <PermissionGuard require="reporting.report.view" fallback={<AccessDenied />}>
      <PageBody className="space-y-(--space-lg)">
        <ReportRunner code={code} />
      </PageBody>
    </PermissionGuard>
  );
}

"use client";

import * as React from "react";
import { TrendingUp } from "lucide-react";

import { formatDateTime } from "@/lib/format/locale";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  observedRangeSentence,
  SparseSeriesChart,
  type SparseSeriesInput,
} from "@/components/platform/sparse-series-chart";
import { usePlatformTenantGrowth } from "@/lib/hooks/use-platform-analytics";
import { hasNoObservations } from "@/lib/models/platform-analytics.model";
import type { HonestSeries, SeriesInterval } from "@/lib/models/platform-analytics.model";

/**
 * Tenant growth, suspension and cancellation over time.
 *
 * <h3>The rule this section is built around</h3>
 *
 * **Where a series has no history, the points that exist are plotted and nothing else is.** No
 * back-filled zeroes, no interpolation across an unobserved bucket, no line extended to the edge
 * of the window. `SparseSeriesChart` implements the drawing half; this section implements the
 * reading half — every series prints its own `coverage` sentence and its own observed range, so a
 * reader is told what the line does not establish at the same moment they see it.
 *
 * <h3>The two caveats that are not cosmetic</h3>
 *
 * <ul>
 *   <li><b>Created is exact.</b> `tenants.created_at` is written once at provisioning and never
 *       rewritten, so the count of tenants created in a bucket is a count.</li>
 *   <li><b>Suspended and cancelled are LOWER BOUNDS.</b> `tenants.suspended_at` and
 *       `tenants.cancelled_at` hold only the MOST RECENT transition and nothing publishes a
 *       lifecycle event, so a tenant suspended twice appears once, in the later bucket. That is
 *       why neither carries a cumulative line: summing a column that overwrites itself counts
 *       nothing. The backend says this in `coverage` and this section renders it verbatim rather
 *       than paraphrasing — a paraphrase is a second copy free to drift from the first.</li>
 * </ul>
 *
 * <h3>Why the interval is a `Select` and not a `FilterBar`</h3>
 *
 * `FilterBar` prepends a real "no filter" option to every control, because a filter a user cannot
 * switch off is a bug it exists to prevent. An interval is not a filter — there is no "all
 * intervals" reading of a bucketed series — so the primitive's central affordance would be
 * meaningless here and its "1 filter active" count would be wrong.
 */

const INTERVAL_OPTIONS = [
  { value: "MONTH", label: "By month" },
  { value: "WEEK", label: "By week" },
  { value: "DAY", label: "By day" },
] as const;

/** `--chart-1` and `--chart-3` collapse toward each other under deuteranopia, so the dash differs. */
const SERIES_STYLE: Array<{ colorVar: SparseSeriesInput["colorVar"]; dash?: string }> = [
  { colorVar: "--chart-1" },
  { colorVar: "--chart-2", dash: "6 4" },
  { colorVar: "--chart-5", dash: "2 4" },
];

/**
 * What one series established, underneath the picture.
 *
 * <p>Rendered for EVERY series including the empty ones, and that is the point: a series with no
 * observations disappears from a chart entirely, and a reader who cannot see a line has no way to
 * tell "there were none" from "this metric is not on the chart". The sentence says which.
 */
function SeriesCaveat({ label, series }: { label: string; series: HonestSeries }) {
  const range = observedRangeSentence(series);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
        {label}
      </span>
      <p className="text-small text-foreground-secondary">
        {series.points.length === 0 ? (
          <span className="font-medium text-foreground">
            {range === null
              ? "Never observed. This is not a run of zeroes — there is no record of this event ever happening on this platform."
              : "No observation inside this window."}{" "}
          </span>
        ) : null}
        {range === null ? null : <>{range} </>}
        {series.coverage}
      </p>
    </div>
  );
}

export function AnalyticsGrowth() {
  const [interval, setInterval] = React.useState<SeriesInterval>("MONTH");
  const growth = usePlatformTenantGrowth({ interval });
  const data = growth.data;

  const allSeries = React.useMemo(
    () => (data ? [data.created, data.suspended, data.cancelled] : []),
    [data],
  );

  const chartSeries: SparseSeriesInput[] = data
    ? [
        { label: "Created", series: data.created, ...SERIES_STYLE[0]! },
        { label: "Suspended", series: data.suspended, ...SERIES_STYLE[1]! },
        { label: "Cancelled", series: data.cancelled, ...SERIES_STYLE[2]! },
      ]
    : [];

  return (
    <ConsoleSection
      anchorId="platform-growth"
      eyebrow="Growth"
      title="Tenant lifecycle over time"
      description={
        data
          ? `${formatDateTime(data.created.windowFrom, { day: "2-digit", month: "short", year: "numeric" })} — ${formatDateTime(data.created.windowTo, { day: "2-digit", month: "short", year: "numeric" })}, cut by the server in ${data.created.zone}. Buckets with no observation are absent, never zero.`
          : "Buckets with no observation are absent, never zero — a zero and an unmeasured period are different facts."
      }
      action={
        <div className="flex items-center gap-2">
          <Label htmlFor="growth-interval" className="text-label text-foreground-tertiary">
            Bucket
          </Label>
          <Select
            id="growth-interval"
            data-testid="growth-interval"
            className="w-36"
            options={INTERVAL_OPTIONS}
            value={interval}
            onValueChange={(value) => setInterval(value as SeriesInterval)}
          />
        </div>
      }
      data-testid="analytics-growth"
    >
      <QueryBoundary
        query={growth}
        what="tenant growth"
        moduleLabel="Platform"
        stillWorks="The tenant population, usage and audit screens read different queries and are unaffected by this."
        // EMPTY here means every one of the three series came back with no observations at all —
        // which on a platform with tenants is a real and stateable answer, not a blank chart. A
        // chart with three invisible lines looks broken; this says what it means.
        isEmpty={data !== undefined && hasNoObservations(allSeries)}
        empty={
          <div className="flex flex-col gap-(--space-md)">
            <EmptyState
              icon={TrendingUp}
              title="No lifecycle events in this window"
              description="No tenant was created, suspended or cancelled between these dates. Nothing has been back-filled to fill the chart."
            />
            {data ? (
              <div className="flex flex-col gap-(--space-sm)">
                <SeriesCaveat label="Created" series={data.created} />
                <SeriesCaveat label="Suspended" series={data.suspended} />
                <SeriesCaveat label="Cancelled" series={data.cancelled} />
              </div>
            ) : null}
          </div>
        }
        loading={<Skeleton className="h-64 rounded-xl" />}
      >
        {data ? (
          <div className="flex flex-col gap-(--space-lg)">
            <SparseSeriesChart
              series={chartSeries}
              windowFrom={data.created.windowFrom}
              windowTo={data.created.windowTo}
              data-testid="growth-chart"
            />

            <div className="grid gap-(--space-md) md:grid-cols-3">
              <SeriesCaveat label="Created" series={data.created} />
              <SeriesCaveat label="Suspended" series={data.suspended} />
              <SeriesCaveat label="Cancelled" series={data.cancelled} />
            </div>

            <ConsoleNote data-testid="growth-gap-note">
              A break in a line is a period with no observation, and it is drawn as a break on
              purpose. Joining across it would interpolate values nobody measured; filling it with
              zero would assert a measurement nobody made. Before a series&apos; first observation
              the platform had no such record at all.
            </ConsoleNote>
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

"use client";

import { HourlyRevenueChart, toHourlySeries } from "@/components/reporting/HourlyRevenueChart";
import { OrderTypeMix, toOrderTypeSlices } from "@/components/reporting/OrderTypeMix";
import type { ReportResult } from "@/lib/models/reporting.model";

/**
 * The one place that says which reports have a picture.
 *
 * <h3>Why a registry and not a prop</h3>
 *
 * `/app/reports/[code]` is a generic runner: it does not know what a report means, and it must
 * not learn. Two of the seven catalog reports can be drawn honestly today — `sales-by-hour` and
 * `sales-by-order-type`, both of which have been computed and served since phase 12 and neither
 * of which has ever been visualised anywhere in the product. Keying that off `result.code` here
 * keeps the page generic and puts the whole answer to "does this report have a chart?" on one
 * screen, where the next reader can see that the answer is *no* for five of them.
 *
 * <h3>Silence, not furniture</h3>
 *
 * A report with no registered visual renders nothing at all — not an empty panel, not a
 * placeholder. And a registered visual whose rows turn out not to carry the shape it needs says
 * so in one line rather than drawing an empty axis: `bg-decorative` is deliberately colourless
 * (D-38-19) so this stays quieter than an error, because a chart that cannot be drawn is not a
 * failure of the report — every figure is still in the grid immediately below.
 */

export function ReportVisual({ result }: { result: ReportResult }) {
  // An empty result already has one honest answer — `DataGrid`'s empty state — and a second
  // panel saying the same thing in different words is noise.
  if (result.rows.length === 0) return null;

  if (result.code === "sales-by-hour") {
    const series = toHourlySeries(result.rows);
    return (
      <VisualPanel title="Revenue by hour">
        {series === null ? (
          <NotDrawable reason="These rows carry no readable hour bucket, so the shape of the day cannot be drawn." />
        ) : (
          <HourlyRevenueChart series={series} />
        )}
      </VisualPanel>
    );
  }

  if (result.code === "sales-by-order-type") {
    const slices = toOrderTypeSlices(result.rows);
    return (
      <VisualPanel title="Revenue by order type">
        {slices === null ? (
          <NotDrawable reason="These rows carry no readable order type, so the split cannot be drawn." />
        ) : (
          <OrderTypeMix slices={slices} />
        )}
      </VisualPanel>
    );
  }

  return null;
}

function VisualPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      data-testid="report-visual"
      className="rounded-xl border border-border bg-card p-(--space-md) text-card-foreground shadow-depth-1"
    >
      <h2 className="mb-(--space-md) text-label font-semibold tracking-wide text-foreground-secondary uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NotDrawable({ reason }: { reason: string }) {
  return (
    <p className="rounded-lg bg-decorative p-(--space-md) text-small text-foreground-tertiary">
      {reason}
    </p>
  );
}

"use client";

import { useId } from "react";

import { MoneyDisplay } from "@/components/ui/money-display";
import { formatHourLabel } from "@/components/reporting/report-cells";
import { formatNumber } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * Revenue by hour — the `sales-by-hour` report, drawn.
 *
 * <h3>Why this one</h3>
 *
 * `ReportCatalog.java:116-128` has computed `sales-by-hour` since phase 12 and nothing in the
 * product has ever drawn it; it was reachable only as three numeric columns on a generic table.
 * It is also, per the demo calibration (DEMO-STATS §N12), *"the only stat in the demo that
 * directly informs rota decisions"* — the double peak at 13:00 and 19:00 is a staffing
 * instruction, and a staffing instruction is unreadable as a sorted list of twelve integers.
 * It is one of the few demo charts this system can draw honestly, so it is drawn.
 *
 * <h3>Bars, not a line — and that is a data decision, not a style one</h3>
 *
 * `components/dashboard/portlets/trend-chart.tsx` is the precedent for the TECHNIQUE (hand-written
 * inline SVG, no charting library, `aria-hidden` picture over a real textual channel, direct
 * labels instead of a swatch legend) and it is followed here. It is deliberately NOT followed on
 * the mark: a polyline interpolates, and the space between 13:00 and 14:00 contains no data. A
 * line drawn through hourly buckets invites a reader to take a value off it at 13:30, and there
 * is no such value — the bucket is `toHour(closed_at)`, a discrete group, not a sample of a
 * continuous signal. Bars occupy the interval they describe and claim nothing between them.
 *
 * <h3>No charting library, and none may be added</h3>
 *
 * UI-SPEC §12 fixes the runtime dependency budget at 24 with zero additions, asserted by
 * `dependency-budget.test.ts`. Recharts would drag `@reduxjs/toolkit`, `react-redux`, `immer` and
 * `victory-vendor` behind it to draw twelve rectangles.
 *
 * <h3>An hour with no row is a real zero, and it is drawn — and said</h3>
 *
 * The SQL is `GROUP BY toHour(closed_at)` with no `HAVING`, so an hour absent from the result is
 * an hour in which no order closed: a genuine zero, not an unknown. Plotting only the hours that
 * came back would put 11:00 and 14:00 side by side at equal spacing and destroy the one thing the
 * chart is for — the SHAPE of the trading day. So the span between the first and last observed
 * hour is filled, gaps are drawn at zero, and the caption says so in words. This is the one
 * inference the component makes and it is stated on screen rather than buried here.
 *
 * <p>The span is the observed one, never a forced 00:00–23:00. A restaurant trading 11:00–23:00
 * would otherwise spend eleven columns on guaranteed zeros and compress the peaks into
 * illegibility.
 *
 * <h3>The peaks are computed, and the second one has a stated bar to clear</h3>
 *
 * A local maximum is labelled directly on the chart. A second peak is labelled only when it is a
 * separate local maximum, at least two hours from the first, worth at least half the first —
 * below that it is noise in a quiet hour, and naming it would invent a service peak, which on
 * this particular chart means inventing a shift. That threshold is a decision about which LABELS
 * to draw; it changes no bar and hides no data, and every hour is in the list below regardless.
 *
 * <h3>No money inside the SVG</h3>
 *
 * `components/ui/money-display.tsx` is the product's only money path, and it emits `<span>`s that
 * cannot live inside an SVG `<text>`. Rather than hand-roll a second rupee formatter for axis
 * ticks — the exact way a screen and a printed bill come to disagree — the picture carries no
 * money at all. It carries geometry and hour labels; every rupee figure is rendered outside it,
 * through `MoneyDisplay`, where both the sighted reader and the screen reader get it.
 *
 * <h3>The picture is decorative; the data is text</h3>
 *
 * The `<svg>` is `aria-hidden`, and beneath it a visually-hidden list carries every hour with its
 * revenue and its order count. `trend-chart.tsx` uses a `<table>` for this; a list is used here
 * because gate G4 (`conformance.test.ts`) requires new files to hand-roll zero tables, and a
 * one-dimensional series reads perfectly well as sentences. A visible readout of the peaks sits
 * under the chart for sighted keyboard and low-vision readers, who get neither the picture nor
 * the hidden list.
 */

export interface HourlyRevenuePoint {
  /** 0–23, from `toHour(closed_at)`. */
  hour: number;
  revenuePaisa: number;
  orderCount: number;
  /** `false` when no row came back for this hour — a real zero, filled in and declared. */
  observed: boolean;
}

const VIEW_W = 640;
const VIEW_H = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 26; // room for the peak labels above the tallest bar
const PAD_B = 26; // room for the hour axis

/** Below this share of the tallest peak, a second local maximum is a quiet hour, not a peak. */
const SECOND_PEAK_MIN_SHARE = 0.5;
/** A "second peak" one hour from the first is the same rush with a wobble in it. */
const SECOND_PEAK_MIN_DISTANCE = 2;

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

/**
 * Report rows → a gap-filled hourly series, or `null` when nothing usable came back.
 *
 * <p>Exported so the page can ask "is there a chart here?" without rendering one, and so the
 * gap-filling rule is testable on its own rather than only through the SVG.
 */
export function toHourlySeries(
  rows: readonly Record<string, unknown>[],
): HourlyRevenuePoint[] | null {
  const observed = new Map<number, { revenuePaisa: number; orderCount: number }>();

  for (const row of rows) {
    const hour = readNumber(row.hour_of_day);
    // A row whose bucket is not an hour is not plottable and is not guessed at. It still appears
    // in the grid beneath, where the reader can see it for themselves.
    if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    observed.set(hour, {
      revenuePaisa: readNumber(row.revenue_paisa) ?? 0,
      orderCount: readNumber(row.order_count) ?? 0,
    });
  }

  if (observed.size === 0) return null;

  const hours = [...observed.keys()].sort((a, b) => a - b);
  const first = hours[0]!;
  const last = hours[hours.length - 1]!;

  const series: HourlyRevenuePoint[] = [];
  for (let hour = first; hour <= last; hour += 1) {
    const hit = observed.get(hour);
    series.push({
      hour,
      revenuePaisa: hit?.revenuePaisa ?? 0,
      orderCount: hit?.orderCount ?? 0,
      observed: hit !== undefined,
    });
  }
  return series;
}

/** Indices of the labelled peaks, in chart order. Never more than two. */
export function findPeaks(series: readonly HourlyRevenuePoint[]): number[] {
  const values = series.map((p) => p.revenuePaisa);
  const maxima: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    if (value <= 0) continue;
    const risesInto = i === 0 || value > values[i - 1]!;
    // `>=` on the right so a two-hour plateau resolves to its first hour rather than to neither.
    const fallsOut = i === values.length - 1 || value >= values[i + 1]!;
    if (risesInto && fallsOut) maxima.push(i);
  }
  if (maxima.length === 0) return [];

  const ranked = [...maxima].sort((a, b) => values[b]! - values[a]!);
  const primary = ranked[0]!;
  const secondary = ranked
    .slice(1)
    .find(
      (i) =>
        Math.abs(i - primary) >= SECOND_PEAK_MIN_DISTANCE &&
        values[i]! >= values[primary]! * SECOND_PEAK_MIN_SHARE,
    );

  return (secondary === undefined ? [primary] : [primary, secondary]).sort((a, b) => a - b);
}

export function HourlyRevenueChart({
  series,
  className,
}: {
  series: readonly HourlyRevenuePoint[];
  className?: string;
}) {
  const gradientId = useId();

  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;
  const count = series.length;

  // A floor of 1 so an all-zero period draws a flat baseline rather than dividing by zero.
  const max = Math.max(1, ...series.map((p) => p.revenuePaisa));
  const slot = plotW / Math.max(1, count);
  const barW = Math.max(2, slot * 0.68);

  const peaks = findPeaks(series);
  const peakSet = new Set(peaks);
  const gapCount = series.filter((p) => !p.observed).length;
  const totalOrders = series.reduce((sum, p) => sum + p.orderCount, 0);

  // Every third hour when the axis would otherwise crowd. 640px of viewBox holds about sixteen
  // two-digit labels before they touch; beyond that they are thinned rather than shrunk, because
  // a label too small to read is worse than one that is absent.
  const labelEvery = count <= 16 ? 1 : count <= 26 ? 2 : 3;

  return (
    <figure className={cn("m-0", className)} data-testid="hourly-revenue-chart">
      <figcaption className="mb-(--space-sm) space-y-1">
        <p className="text-body font-medium">{peakSentence(series, peaks)}</p>
        <p className="text-small text-foreground-tertiary">
          {formatNumber(totalOrders)} order{totalOrders === 1 ? "" : "s"} closed between{" "}
          {formatHourLabel(series[0]!.hour)} and {formatHourLabel(series[count - 1]!.hour)}
          {gapCount > 0
            ? ` · ${formatNumber(gapCount)} hour${gapCount === 1 ? "" : "s"} in that span closed no orders and are drawn at zero`
            : ""}
        </p>
      </figcaption>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-48 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* Baseline only. Horizontal gridlines would need money ticks to mean anything, and no
            money is drawn inside this SVG — see the docblock. */}
        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={PAD_T + plotH}
          y2={PAD_T + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />

        {series.map((point, i) => {
          const height = (point.revenuePaisa / max) * plotH;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const isPeak = peakSet.has(i);
          return (
            <g key={point.hour}>
              <rect
                x={x}
                y={PAD_T + plotH - height}
                width={barW}
                // A zero-revenue hour keeps a 1px stub so the reader can see the hour exists and
                // was empty, rather than seeing a hole where a bar might not have been drawn.
                height={Math.max(height, 1)}
                rx="2"
                fill={`url(#${gradientId})`}
                opacity={isPeak ? 1 : 0.62}
              />
              {isPeak && (
                <text
                  x={x + barW / 2}
                  y={PAD_T + plotH - height - 8}
                  fill="var(--chart-1)"
                  fontSize="12"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {formatHourLabel(point.hour)}
                </text>
              )}
            </g>
          );
        })}

        {series.map((point, i) =>
          i % labelEvery === 0 || peakSet.has(i) ? (
            <text
              key={point.hour}
              x={PAD_L + i * slot + slot / 2}
              y={VIEW_H - 8}
              fill="var(--foreground-tertiary)"
              fontSize="11"
              textAnchor="middle"
            >
              {String(point.hour).padStart(2, "0")}
            </text>
          ) : null,
        )}
      </svg>

      {/* Sighted keyboard and low-vision readers get the peak figures without the picture. */}
      <div
        className="mt-(--space-sm) flex flex-wrap gap-x-(--space-lg) gap-y-1 text-small text-foreground-secondary"
        data-testid="hourly-revenue-peaks"
      >
        {peaks.map((i) => (
          <span key={series[i]!.hour} className="tabular-nums">
            <span className="font-semibold">{formatHourLabel(series[i]!.hour)}</span>{" "}
            <MoneyDisplay paisa={series[i]!.revenuePaisa} /> from{" "}
            {formatNumber(series[i]!.orderCount)} order{series[i]!.orderCount === 1 ? "" : "s"}
          </span>
        ))}
      </div>

      {/* The chart, as data. Not an `aria-label` summary — the actual numbers, every hour. */}
      <ul className="sr-only">
        {series.map((point) => (
          <li key={point.hour}>
            {formatHourLabel(point.hour)} — <MoneyDisplay paisa={point.revenuePaisa} /> from{" "}
            {formatNumber(point.orderCount)} order{point.orderCount === 1 ? "" : "s"}
            {point.observed ? "" : " (no orders closed in this hour)"}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The rota sentence. Says "two peaks" only when two were actually found. */
function peakSentence(series: readonly HourlyRevenuePoint[], peaks: readonly number[]): string {
  if (peaks.length === 0) return "No hour in this period took any revenue.";
  if (peaks.length === 1) return `Busiest at ${formatHourLabel(series[peaks[0]!]!.hour)}.`;
  return `Two peaks — ${formatHourLabel(series[peaks[0]!]!.hour)} and ${formatHourLabel(series[peaks[1]!]!.hour)}.`;
}

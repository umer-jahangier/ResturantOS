import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { cn } from "@/lib/utils";
import type {
  HonestSeries,
  SeriesInterval,
  SeriesPoint,
} from "@/lib/models/platform-analytics.model";

/**
 * A time chart for series that are allowed to have holes in them.
 *
 * <h3>Why `TrendChart` could not be reused, and this is not a parallel version of it</h3>
 *
 * `components/dashboard/portlets/trend-chart.tsx` takes `categories: string[]` and
 * `values: number[]` of equal length and plots value `i` at x-position `i`. That shape is correct
 * for what it draws — a thirty-day sales window where every day exists and every day has a
 * reading — and it is structurally incapable of drawing what this screen has:
 *
 * <ul>
 *   <li>an INDEX x-axis puts two observations side by side whether they are one month apart or
 *       eleven, so a platform that provisioned two tenants in January and one in December would
 *       render as three evenly-spaced events;</li>
 *   <li>a dense `values` array has no way to say "nothing was observed here" except `0`, and a
 *       zero is a measurement. `PlatformAnalyticsDtos` refuses to emit one for exactly this
 *       reason, and a component that requires a dense array would put it back at the last step.</li>
 * </ul>
 *
 * So the difference is in the DOMAIN, not the styling: x is an instant, and a series is a list of
 * observations rather than a list of periods. Everything else — the aria-hidden SVG over a
 * visually-hidden text alternative, direct end-of-line labels instead of a swatch legend, dash
 * patterns as a second channel, dotted gridlines on `--border` — is deliberately identical, and
 * where the two files agree they agree on purpose.
 *
 * <h3>The line BREAKS at a gap, and that is the whole point of the component</h3>
 *
 * Two observations in adjacent buckets are joined. Two observations with an unobserved bucket
 * between them are NOT joined — the segment ends and a new one begins.
 *
 * <p>A continuous line across a gap is an interpolation, and an interpolation is a claim: it says
 * the metric passed through every value between the two endpoints during the missing periods.
 * Here the missing periods were not measured at all — before a series' `observedFrom` the platform
 * had no tenants, so there was nothing to measure — and drawing through them would manufacture
 * exactly the smooth history the backend spent a whole DTO refusing to manufacture. A broken line
 * looks less finished. It is also the only version that is true.
 *
 * <h3>Screen readers get the observations, not a picture and not a summary</h3>
 *
 * The SVG is `aria-hidden`. Underneath it is a visually-hidden list carrying every observed
 * bucket and its count, plus the observed range of each series in words. `TrendChart` uses a
 * `<table>` for this; a NEW file may not, because conformance gate G4 requires files absent from
 * the baseline to score zero hand-rolled `<table>`s and `DataGrid` is not a thing to render
 * `sr-only`. A definition list of period → count carries the same facts in the same order.
 */

export type ChartColorVar = "--chart-1" | "--chart-2" | "--chart-3" | "--chart-4" | "--chart-5";

export interface SparseSeriesInput {
  /** Rendered AT the end of the line, in the line's own colour. There is no swatch to match. */
  label: string;
  series: HonestSeries;
  colorVar: ChartColorVar;
  /** SVG dash pattern; `undefined` is solid. The channel that survives greyscale and CVD. */
  dash?: string;
}

interface SparseSeriesChartProps {
  series: SparseSeriesInput[];
  /** The window the server cut, echoed from the response. Never restated as a literal. */
  windowFrom: Date;
  windowTo: Date;
  className?: string;
  "data-testid"?: string;
}

const VIEW_W = 640;
const VIEW_H = 220;
const PAD_L = 10;
/** Room for the direct end-of-line labels — the reason there is no swatch legend. */
const PAD_R = 116;
const PAD_T = 14;
const PAD_B = 30;

const DAY_MS = 86_400_000;

/**
 * How far apart two bucket starts may be and still count as adjacent.
 *
 * <p>A tolerance rather than exact bucket arithmetic, because the buckets were cut server-side in
 * an IANA zone and reconstructing "the next month after this one" in the browser means re-deriving
 * a calendar the server already applied — with a different library, in a possibly different zone,
 * on data whose whole point is that its boundaries are exact.
 *
 * <p>1.5× the nominal period separates the two cases with room to spare in both directions.
 * MONTH is the tight one and it still is not close: the shortest real gap is February to March at
 * 28 days (adjacent, and 28 < 46.5), and the shortest FALSE gap is two months at 59 days
 * (broken, and 59 > 46.5). DAY and WEEK have no ambiguity at all.
 */
const ADJACENCY_TOLERANCE_MS: Record<SeriesInterval, number> = {
  DAY: DAY_MS * 1.5,
  WEEK: DAY_MS * 7 * 1.5,
  MONTH: DAY_MS * 31 * 1.5,
};

/** Window boundaries are days; an hour on them would imply a precision they do not have. */
const DAY_LABEL: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/**
 * Split a series into runs of consecutive buckets.
 *
 * <p>Each run becomes one polyline. A run of length 1 is an isolated observation and renders as a
 * dot with no line — which is the honest picture of "this happened once, and we know nothing about
 * the periods either side".
 */
function segmentsOf(series: HonestSeries): SeriesPoint[][] {
  const tolerance = ADJACENCY_TOLERANCE_MS[series.interval];
  const runs: SeriesPoint[][] = [];
  let current: SeriesPoint[] = [];

  for (const point of series.points) {
    const previous = current[current.length - 1];
    if (previous && point.bucketStart.getTime() - previous.bucketStart.getTime() > tolerance) {
      runs.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** The observed record of one series, in words. Null when the metric has never been observed. */
export function observedRangeSentence(series: HonestSeries): string | null {
  if (series.observedFrom === null) return null;
  const from = formatDateTime(series.observedFrom, DAY_LABEL);
  const to = series.observedTo === null ? null : formatDateTime(series.observedTo, DAY_LABEL);
  return to === null || to === from
    ? `First and only observation ${from}.`
    : `Observed from ${from} to ${to}.`;
}

export function SparseSeriesChart({
  series,
  windowFrom,
  windowTo,
  className,
  "data-testid": testId = "sparse-series-chart",
}: SparseSeriesChartProps) {
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  const fromMs = windowFrom.getTime();
  const toMs = windowTo.getTime();
  // A zero-width window would divide by zero and put every point at NaN, which renders as an empty
  // SVG — indistinguishable from "nothing was observed". Collapse it to the left edge instead.
  const spanMs = Math.max(1, toMs - fromMs);

  // ONE shared y-scale across all three series, so their heights are comparable by eye. A per-
  // series axis would let the chart imply that a month with two cancellations was as eventful as
  // a month with twenty sign-ups.
  const peak = Math.max(1, ...series.flatMap((s) => s.series.points.map((p) => p.count)));

  const x = (at: Date) => PAD_L + ((at.getTime() - fromMs) / spanMs) * plotW;
  const y = (value: number) => PAD_T + plotH - (value / peak) * plotH;

  return (
    <figure className={cn("m-0", className)} data-testid={testId}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-52 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* The paper: four dotted references plus a solid baseline, on `--border` — the quietest
            line in the system and already the colour of the card's own hairline. */}
        <g data-testid="sparse-series-grid">
          {[0.25, 0.5, 0.75, 1].map((step) => (
            <line
              key={step}
              x1={PAD_L}
              x2={PAD_L + plotW}
              y1={PAD_T + plotH - step * plotH}
              y2={PAD_T + plotH - step * plotH}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="2 5"
            />
          ))}
        </g>
        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={PAD_T + plotH}
          y2={PAD_T + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />

        {series.map((entry) => {
          const runs = segmentsOf(entry.series);
          const last = entry.series.points[entry.series.points.length - 1];
          return (
            <g key={entry.label}>
              {runs.map((run, runIndex) =>
                run.length > 1 ? (
                  <polyline
                    key={runIndex}
                    data-testid="sparse-series-segment"
                    points={run.map((p) => `${x(p.bucketStart)},${y(p.count)}`).join(" ")}
                    fill="none"
                    stroke={`var(${entry.colorVar})`}
                    strokeWidth="2.5"
                    strokeDasharray={entry.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
              )}
              {/* Every observation gets a dot, including the ones inside a run. On a sparse series
                  the dots are the data — they are what says "this is a reading", where the line
                  only says "these two readings are consecutive". */}
              {entry.series.points.map((point) => (
                <circle
                  key={point.bucketStart.getTime()}
                  data-testid="sparse-series-point"
                  cx={x(point.bucketStart)}
                  cy={y(point.count)}
                  r="3.5"
                  fill={`var(${entry.colorVar})`}
                />
              ))}
              {/* CHANNEL 1 — the name, on the line, with no swatch to match. Placed at the last
                  observation rather than at the right edge, because the line ENDS where the
                  observations end and a label floating past it would imply the series continues. */}
              {last ? (
                <text
                  data-testid="sparse-series-label"
                  x={Math.min(x(last.bucketStart) + 8, PAD_L + plotW + 8)}
                  y={y(last.count) + 4}
                  fill={`var(${entry.colorVar})`}
                  fontSize="12"
                  fontWeight="700"
                >
                  {entry.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* The window, at both ends. Two labels and not six: the buckets are irregular by
            construction, so an evenly-strided axis would be labelling positions that no
            observation occupies. */}
        <text
          x={PAD_L}
          y={VIEW_H - 8}
          fill="var(--foreground-tertiary)"
          fontSize="11"
          textAnchor="start"
        >
          {formatDateTime(windowFrom, DAY_LABEL)}
        </text>
        <text
          x={PAD_L + plotW}
          y={VIEW_H - 8}
          fill="var(--foreground-tertiary)"
          fontSize="11"
          textAnchor="end"
        >
          {formatDateTime(windowTo, DAY_LABEL)}
        </text>
      </svg>

      {/* CHANNEL 2 — the pattern key, described in words so it reads in greyscale too, and the
          peak, so a reader knows what the top gridline is worth. */}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-foreground-tertiary">
        {series.map((entry) => (
          <span key={entry.label} className="inline-flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={`var(${entry.colorVar})`}
                strokeWidth="2.5"
                strokeDasharray={entry.dash}
              />
            </svg>
            {entry.label} — {entry.dash ? "dashed" : "solid"}
          </span>
        ))}
        <span className="tabular-nums">Peak {formatNumber(peak)} per bucket</span>
      </figcaption>

      {/*
        The chart as data. Not an `aria-label` summary — the actual observations, in order.

        A `<dl>` rather than the `<table>` `TrendChart` uses: gate G4 requires a file absent from
        the conformance baseline to score zero hand-rolled tables, and this is one. Nothing is
        lost — a period and its count is a term and its definition, and the gaps read correctly
        because the missing periods are simply not listed.
      */}
      <dl className="sr-only" data-testid="sparse-series-readout">
        {series.map((entry) => (
          <div key={entry.label}>
            <dt>{entry.label}</dt>
            <dd>
              {entry.series.points.length === 0
                ? `No observation in this window. ${observedRangeSentence(entry.series) ?? "This metric has never been observed."}`
                : `${observedRangeSentence(entry.series) ?? ""} ${entry.series.points
                    .map((p) => `${p.bucketLabel}: ${formatNumber(p.count)}`)
                    .join(
                      "; ",
                    )}. Periods that are not listed had no observation and were not measured as zero.`}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

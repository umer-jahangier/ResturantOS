"use client";

import { useId } from "react";

import { T_LABEL, T_SMALL } from "@/components/dashboard/dashboard-type";
import { cn } from "@/lib/utils";

export interface TrendSeries {
  /** Series name — rendered AT the line, not in a swatch legend. */
  label: string;
  /** Values, oldest first. Must be the same length as `categories`. */
  values: number[];
  /** `--chart-1`..`--chart-5`. Colour is the LAST channel here, never the only one. */
  colorVar: "--chart-1" | "--chart-2" | "--chart-3" | "--chart-4" | "--chart-5";
  /** SVG dash pattern. `undefined` = solid. This is what survives greyscale and CVD. */
  dash?: string;
  /** How to render a value in the direct label and the table. */
  format: (value: number) => string;
}

interface TrendChartProps {
  categories: string[];
  series: TrendSeries[];
  className?: string;
}

const VIEW_W = 640;
const VIEW_H = 200;
const PAD_L = 8;
const PAD_R = 96; // room for the direct end-of-line labels
const PAD_T = 12;
const PAD_B = 26;

/**
 * A two-series trend chart, drawn as inline SVG.
 *
 * <h3>Why a swatch legend is a contract violation, not a style preference</h3>
 *
 * UI-SPEC §3.4 derives the five chart colours and then says the quiet part: no five-colour
 * categorical palette is CVD-safe by colour alone. Deuteranopia collapses `--chart-1` and
 * `--chart-3` toward each other; greyscale collapses more. A legend that says
 * "▪ Net sales ▪ Orders" and then draws two lines is therefore a chart that ~8% of men
 * cannot read at all — it asks the reader to perform a colour match the chart has already
 * made impossible.
 *
 * Two channels replace it, and either one alone is sufficient:
 *
 *   1. **Direct labels.** Each series is named at the END of its own line, in that line's
 *      colour, with its latest value. There is no matching step: the word is on the line.
 *   2. **Dash patterns.** One series is solid, the next dashed, the next dotted. That is
 *      geometry, and geometry survives every simulation in `wcag-validator.ts`.
 *
 * <h3>Why not Recharts</h3>
 *
 * §7.3 permits Recharts on dashboard routes only, because its dependency tree drags in
 * `@reduxjs/toolkit`, `react-redux`, `immer` and `victory-vendor`. It is not currently a
 * dependency of this repo, and adding ~400kB of transitive state-management machinery to
 * draw two polylines is not a trade this screen needs to make. Two polylines are two
 * polylines. If a later screen needs brushing, tooltips and stacked areas, that is the
 * moment to take the dependency — and this component's props are shaped so it can be
 * swapped without touching a caller.
 *
 * <h3>Screen readers get the table, not the picture</h3>
 *
 * The SVG is `aria-hidden`. Underneath it is a real `<table>`, visually hidden, carrying
 * every point. A chart described only by an `aria-label` summary is a chart a blind user
 * has to take on trust.
 */
export function TrendChart({ categories, series, className }: TrendChartProps) {
  const gradientId = useId();
  const maskId = useId();
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  // One shared scale so the two series are comparable by eye. A dual axis would let the
  // chart imply a crossover that is an artefact of two independently chosen ranges.
  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);

  const x = (i: number) =>
    categories.length <= 1 ? PAD_L : PAD_L + (i / (categories.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  /*
   * The reveal length, computed from the geometry rather than measured from the DOM.
   *
   * `getTotalLength()` would need a ref, a layout pass and a state write, and would produce a
   * different number on the server than in the browser. The plot is a straight horizontal
   * sweep, so the sweep length is simply the plot width plus the left pad — arithmetic, on
   * both renderers, with no effect and no re-render.
   */
  const revealLength = PAD_L + plotW;

  return (
    <figure className={cn("m-0", className)} data-testid="trend-chart">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-44 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>

          {/*
           * The reveal (34-06): a MASK over an unchanged drawing.
           *
           * The line below is the only animated thing in this component, and the only property
           * that animates on it is `stroke-dashoffset` — `.vdl-reveal`'s keyframe carries the
           * opening offset and nothing else, so the element's resting style is its finished
           * style (SPEC §4.1). Nothing about the series geometry changes: the polylines, the
           * polygon and the circles below are byte-for-byte what they were before the reveal
           * existed, which `dashboard-character.test.tsx` asserts against a captured baseline.
           *
           * Why the dash offset is on a MASK rather than on the series strokes themselves:
           * `stroke-dasharray` is already load-bearing on those strokes. UI-SPEC §3.4 makes the
           * dash PATTERN a redundant encoding channel because no five-colour categorical
           * palette is safe under dichromacy, so overwriting it with a reveal-length dash would
           * trade a CVD contract for an animation. One property, two meanings, and the
           * accessibility one loses — so the reveal moved to a surface of its own.
           *
           * `.vdl-reveal` is scoped to `[data-zone="expressive"]` and removed outright under
           * reduced motion, so in both of those cases the mask sits at dashoffset 0 — fully
           * open, chart complete at first paint. Not fast: complete.
           */}
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
          >
            <line
              data-testid="trend-chart-reveal-mask"
              x1="0"
              y1={VIEW_H / 2}
              x2={VIEW_W}
              y2={VIEW_H / 2}
              stroke="white"
              strokeWidth={VIEW_H * 2}
              strokeDasharray={VIEW_W}
              className="vdl-reveal"
              style={{ ["--vdl-reveal-length" as string]: `${VIEW_W}` }}
            />
          </mask>
        </defs>

        {/* Baseline only. Gridlines on four data points is chartjunk. */}
        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={PAD_T + plotH}
          y2={PAD_T + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />

        <g mask={`url(#${maskId})`} data-testid="trend-chart-revealed">
          {series.map((s, si) => {
            const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            const lastIndex = s.values.length - 1;
            return (
              <g key={s.label}>
                {si === 0 && s.values.length > 1 && (
                  <polygon
                    points={`${PAD_L},${PAD_T + plotH} ${points} ${x(lastIndex)},${PAD_T + plotH}`}
                    fill={`url(#${gradientId})`}
                  />
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke={`var(${s.colorVar})`}
                  strokeWidth="2.5"
                  strokeDasharray={s.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {s.values.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={`var(${s.colorVar})`} />
                ))}
              </g>
            );
          })}
        </g>

        {/*
         * CHANNEL 1 — the name, on the line. No swatch to match.
         *
         * Rendered OUTSIDE the mask, deliberately. UI-SPEC §3.4 measured the minimum series
         * separation under deuteranopia at about seventeen and under protanopia at about
         * sixteen and concluded that no five-colour palette is safe by colour alone. A label
         * that arrives when the line finishes drawing is a label that is absent for the whole
         * animation and absent permanently if the animation never runs — so during a reveal the
         * chart would be identified by colour alone, which is the state §3.4 forbids.
         */}
        {series.map((s) => {
          const lastIndex = s.values.length - 1;
          if (lastIndex < 0) return null;
          return (
            <text
              key={s.label}
              data-testid="trend-chart-series-label"
              x={x(lastIndex) + 8}
              y={y(s.values[lastIndex] ?? 0) + 4}
              fill={`var(${s.colorVar})`}
              fontSize="12"
              fontWeight="700"
            >
              {s.label}
            </text>
          );
        })}

        {categories.map((c, i) => (
          <text
            key={c}
            x={x(i)}
            y={VIEW_H - 8}
            fill="var(--foreground-tertiary)"
            fontSize="11"
            textAnchor={i === 0 ? "start" : i === categories.length - 1 ? "end" : "middle"}
          >
            {c}
          </text>
        ))}
      </svg>

      {/* CHANNEL 2 — the pattern key, described in words, so it reads in greyscale too. */}
      <figcaption
        className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-foreground-tertiary", T_LABEL)}
      >
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={`var(${s.colorVar})`}
                strokeWidth="2.5"
                strokeDasharray={s.dash}
              />
            </svg>
            {s.label} — {s.dash ? "dashed" : "solid"}
          </span>
        ))}
      </figcaption>

      {/* The chart, as data. Not an aria-label summary — the actual numbers. */}
      <table className="sr-only">
        <caption>{series.map((s) => s.label).join(" and ")} by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={c}>
              <th scope="row">{c}</th>
              {series.map((s) => (
                <td key={s.label}>{s.format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Sighted keyboard/low-vision readers get the same numbers without the SVG. */}
      <div className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-foreground-secondary", T_SMALL)}>
        {series.map((s) => (
          <span key={s.label} className="tabular-nums">
            <span className="font-semibold">{s.label}:</span>{" "}
            {s.format(s.values[s.values.length - 1] ?? 0)} latest
          </span>
        ))}
      </div>
    </figure>
  );
}

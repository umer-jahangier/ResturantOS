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
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  // One shared scale so the two series are comparable by eye. A dual axis would let the
  // chart imply a crossover that is an artefact of two independently chosen ranges.
  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);

  const x = (i: number) =>
    categories.length <= 1 ? PAD_L : PAD_L + (i / (categories.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

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
              {/* CHANNEL 1 — the name, on the line. No swatch to match. */}
              {lastIndex >= 0 && (
                <text
                  x={x(lastIndex) + 8}
                  y={y(s.values[lastIndex] ?? 0) + 4}
                  fill={`var(${s.colorVar})`}
                  fontSize="12"
                  fontWeight="700"
                >
                  {s.label}
                </text>
              )}
            </g>
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

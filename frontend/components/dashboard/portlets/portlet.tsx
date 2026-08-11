"use client";

import Link from "next/link";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { T_BODY, T_DISPLAY, T_H2, T_LABEL, T_SMALL } from "@/components/dashboard/dashboard-type";
import { cn } from "@/lib/utils";

/**
 * The portlet chrome and the four simple portlet bodies (§7.3).
 *
 * `TrendChart` lives in its own file because its accessibility contract is long enough to
 * deserve one. Everything else — a KPI, a ranked list, an exception list, a record list —
 * is small, and keeping them together keeps their shared conventions honestly shared:
 *
 *   · **Every portlet is a link.** §7.3: "a KPI you cannot click is a poster, not a
 *     dashboard." The whole card is the target, not a "view more" in the corner.
 *   · **`--primary-700`, never `--primary-500/600`.** §3.8 measured 500 and 600 against
 *     white and both FAIL; 700 is 5.46:1. The token exists so nobody has to remember that.
 *   · **A missing number is `—` with a reason, never `0`.** This codebase has already
 *     shipped a "Closed sales: Rs 0.00" that was a query bug, not a quiet day, and a
 *     journal screen that rendered raw paisa so every total read 100× too large. Both are
 *     the same failure: the UI stating something it does not know.
 */

interface PortletShellProps {
  id: string;
  title?: string;
  drillTo: string;
  /** What clicking through gets you, in the reader's words — announced to screen readers. */
  drillLabel: string;
  density: "comfortable" | "compact";
  className?: string;
  children: React.ReactNode;
}

export function PortletShell({
  id,
  title,
  drillTo,
  drillLabel,
  density,
  className,
  children,
}: PortletShellProps) {
  return (
    <Link
      href={drillTo}
      data-portlet={id}
      data-testid={`portlet-${id}`}
      aria-label={drillLabel}
      className={cn(
        "group flex flex-col rounded-xl text-card-foreground",
        /*
         * Phase 34: a glass panel on a depth-layered grid, with a hover lift on every
         * drillable tile — which is all of them, because §7.3 makes the whole card the target.
         *
         * TREATMENT ONLY. No portlet is added, removed, reordered or re-typed here, and no
         * preset changes; composition belongs to phases 21 and 33. A design pass that quietly
         * re-lays-out a screen is how a restyle becomes an unreviewed feature change.
         *
         * `glass-surface` carries the OPAQUE fallback as its base declaration and gains
         * translucency only inside a feature query, only under [data-zone="expressive"] — so
         * this same component renders as a plain opaque card if it is ever composed on a
         * restrained or operational surface, without a second code path.
         *
         * Substrate is `--background` (the shell's <main> inherits it), which 34-02's manifest
         * enumerates and glass-contrast.test.ts measures.
         */
        "glass-surface shadow-depth-2 vdl-lift",
        density === "compact" ? "gap-1.5 p-3" : "gap-2.5 p-4",
        className,
      )}
    >
      {title && (
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              "font-semibold uppercase tracking-wide text-foreground-tertiary",
              T_LABEL,
            )}
          >
            {title}
          </h3>
          <ArrowUpRight
            className="size-3.5 shrink-0 text-foreground-tertiary opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
      )}
      {children}
    </Link>
  );
}

// ── KpiTile ──────────────────────────────────────────────────────────────────

export interface KpiTileProps {
  id: string;
  title: string;
  drillTo: string;
  density: "comfortable" | "compact";
  /** Already formatted for display. Money must be converted from paisa BEFORE it gets here. */
  value: React.ReactNode;
  /** One line of context under the number. */
  caption: string;
  /**
   * Percentage change vs the prior period, or null when there is no comparable prior period.
   * Null renders "no prior period" — NOT "0%", which claims the business was flat.
   */
  deltaPct?: number | null;
  /** Whether an increase is good. Late tickets going up is not good news. */
  higherIsBetter?: boolean;
  /** Values for a sparkline, oldest first. Omitted when there is no series to draw. */
  spark?: number[];
  /** Set when the number genuinely cannot be computed — renders "—" plus the reason. */
  unavailableReason?: string;
  /** Escalated appearance for a count that means "somebody must act". */
  tone?: "neutral" | "warning" | "danger";
}

export function KpiTile({
  id,
  title,
  drillTo,
  density,
  value,
  caption,
  deltaPct,
  higherIsBetter = true,
  spark,
  unavailableReason,
  tone = "neutral",
}: KpiTileProps) {
  const good = deltaPct == null ? null : higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;
  const DeltaIcon = deltaPct == null ? Minus : deltaPct >= 0 ? TrendingUp : TrendingDown;

  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open details`}
      density={density}
    >
      {unavailableReason ? (
        <>
          <p
            className={cn("font-semibold tabular-nums text-foreground-tertiary", T_DISPLAY)}
            data-testid={`kpi-value-${id}`}
          >
            —
          </p>
          {/* The reason, not a zero. "0%" here would be an assertion about the business. */}
          <p className={cn("text-foreground-tertiary", T_SMALL)}>{unavailableReason}</p>
        </>
      ) : (
        <>
          <p
            className={cn(
              "font-semibold tabular-nums",
              T_DISPLAY,
              tone === "danger" && "text-destructive",
              tone === "warning" && "text-warning-foreground",
            )}
            data-testid={`kpi-value-${id}`}
          >
            {value}
          </p>
          <div className={cn("flex items-center gap-2 text-foreground-secondary", T_SMALL)}>
            <span>{caption}</span>
          </div>
          {deltaPct !== undefined && (
            <p
              className={cn(
                "inline-flex items-center gap-1 font-medium tabular-nums",
                T_SMALL,
                good === null
                  ? "text-foreground-tertiary"
                  : good
                    ? "text-success-foreground"
                    : "text-destructive",
              )}
              data-testid={`kpi-delta-${id}`}
            >
              <DeltaIcon className="size-3.5" aria-hidden="true" />
              {deltaPct == null
                ? "No comparable prior period"
                : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs prior`}
            </p>
          )}
          {spark && spark.length > 1 && <Sparkline values={spark} />}
        </>
      )}
    </PortletShell>
  );
}

/** A sparkline is decoration over a number that is already stated — hence aria-hidden. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${20 - (v / max) * 18}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 20" className="h-5 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── RankedList ───────────────────────────────────────────────────────────────

export interface RankedRow {
  key: string;
  label: string;
  /** Formatted for display. */
  value: string;
  /**
   * 0..1 — the bar length. Bars are labelled, so length is never the only channel.
   *
   * <p><b>Optional, and that is the fix for a real defect (38-01, UI-SPEC §9.1).</b> This was
   * required, so a caller with nothing to encode had to invent a number — and
   * `manager-dashboard.tsx` invented `fraction: 1` for every 86'd item. The result was three
   * full-width teal bars that always read 100%, four lines from a sibling (`stationLoad`) that
   * computes `count / max` correctly. One portlet component rendered one meaningful bar chart
   * and one meaningless one on the same screen.
   *
   * <p>Brief §47: "every chart answers a business question". §64: "do not make dashboards
   * decorative instead of useful". A bar that is always full answers nothing, so the type now
   * lets a caller say so, and {@link RankedList} renders no bar at all rather than a lie.
   * Omitting it is the honest option; passing `1` for everything is not.
   */
  fraction?: number;
}

export function RankedList({
  id,
  title,
  drillTo,
  density,
  rows,
  emptyLabel,
}: {
  id: string;
  title: string;
  drillTo: string;
  density: "comfortable" | "compact";
  rows: RankedRow[];
  emptyLabel: string;
}) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{emptyLabel}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <div className={cn("flex items-baseline justify-between gap-2", T_BODY)}>
                <span className="truncate font-medium">{row.label}</span>
                <span className="shrink-0 tabular-nums text-foreground-secondary">{row.value}</span>
              </div>
              {/* No fraction, no bar. See RankedRow.fraction — a bar drawn for a row with
                  nothing to encode is decoration that reads as data. */}
              {row.fraction !== undefined && (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-primary-700"
                    style={{ width: `${Math.max(2, Math.round(row.fraction * 100))}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </PortletShell>
  );
}

// ── ExceptionList ────────────────────────────────────────────────────────────

export interface ExceptionRow {
  key: string;
  label: string;
  detail: string;
  severity: "info" | "warning" | "danger";
}

/**
 * Severity carries an icon and a WORD as well as a colour — the same three-channel rule the
 * KDS board follows, for the same reason. An exception list read only by hue is a list a
 * colour-blind manager triages in the wrong order.
 */
export function ExceptionList({
  id,
  title,
  drillTo,
  density,
  rows,
  emptyLabel,
}: {
  id: string;
  title: string;
  drillTo: string;
  density: "comfortable" | "compact";
  rows: ExceptionRow[];
  emptyLabel: string;
}) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)} data-testid={`portlet-${id}-clear`}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider",
                  T_LABEL,
                  row.severity === "danger" && "bg-destructive/15 text-destructive",
                  row.severity === "warning" && "bg-warning/20 text-warning-foreground",
                  row.severity === "info" && "bg-muted text-foreground-secondary",
                )}
              >
                {row.severity === "danger" ? "ACT" : row.severity === "warning" ? "CHECK" : "FYI"}
              </span>
              <span className="min-w-0">
                <span className={cn("block font-medium", T_BODY)}>{row.label}</span>
                <span className={cn("block text-foreground-tertiary", T_SMALL)}>{row.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </PortletShell>
  );
}

// ── RecordList ───────────────────────────────────────────────────────────────

export interface RecordRow {
  key: string;
  primary: string;
  secondary: string;
  trailing: React.ReactNode;
}

export function RecordList({
  id,
  title,
  drillTo,
  density,
  rows,
  emptyLabel,
}: {
  id: string;
  title: string;
  drillTo: string;
  density: "comfortable" | "compact";
  rows: RecordRow[];
  emptyLabel: string;
}) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className={cn("block truncate font-medium", T_BODY)}>{row.primary}</span>
                <span className={cn("block text-foreground-tertiary", T_SMALL)}>
                  {row.secondary}
                </span>
              </span>
              <span className={cn("shrink-0 tabular-nums", T_H2)}>{row.trailing}</span>
            </li>
          ))}
        </ul>
      )}
    </PortletShell>
  );
}

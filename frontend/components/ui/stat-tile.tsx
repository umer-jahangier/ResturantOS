import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * `StatTile` — the one KPI/stat primitive the back office may use (N1, UI-SPEC §5, D-38-15).
 *
 * <h3>Why this file exists at all</h3>
 *
 * `.kpi-card` is the single most-repeated component in `Docs/NEXUS_ERP_Demo.html` — **24
 * instances** across 11 screens — and this product has **no** reusable equivalent. The one good
 * implementation, `KpiTile` in `components/dashboard/portlets/portlet.tsx:122`, is unreachable:
 * it renders through `PortletShell`, which wraps the entire card in a `<Link>` because §7.3 says
 * "a KPI you cannot click is a poster, not a dashboard". That is the right rule **for a
 * dashboard portlet** and the wrong rule everywhere else — a purchasing screen's "Open POs: 14"
 * has nowhere to drill to, so no back-office screen can use `KpiTile` without inventing a
 * destination. The result is that the demo's most repeated component would be re-typed per screen,
 * which is exactly how 60 hand-rolled `<h1>`s and 1,085 off-contract type classes accumulated.
 *
 * <p>So the drill link here is <b>optional and does not define the component</b>. Absent, the tile
 * is not a link and there is nothing in the accessibility tree pretending it is.
 *
 * <h3>What is carried over from `KpiTile`, deliberately, because it is the intelligence</h3>
 *
 * <ol>
 * <li><b>`higherIsBetter` — real polarity, computed.</b> The demo hand-picks `.up`/`.down`, which
 *     control colour only, and it gets them inconsistent: `:667` renders Food Cost `−1.2%` RED
 *     while `:788` renders Waste `−32%` GREEN. Same arithmetic, opposite verdicts, because a human
 *     chose the class. Here the caller states the metric's polarity once and the sentiment is
 *     derived, so a falling cost cannot render as bad news on one screen and good news on another.
 * <li><b>`unavailableReason` — an absence, never a figure (D-38-16).</b> Seventeen of the demo's
 *     headline numbers have no honest source in this system: Food Cost %, COGS (MTD), Net Income
 *     (MTD), Net Margin and the whole Revenue-vs-COGS chart rest on `sales_item_facts.cogs_paisa`,
 *     which is a Phase-8-deferred NULL for every row. This codebase already carries three guards
 *     against that defect class (`ReportCatalog.java:74-80`, `ReportTable.tsx:22-34`,
 *     `owner-dashboard.tsx:52-65`) and has already shipped the defect twice. A tile that cannot
 *     be computed renders `—` plus the stated reason, and its delta row is suppressed — a
 *     percentage change on a number we do not have is a second lie stacked on the first.
 * </ol>
 *
 * <h3>Three channels on the delta, not one (D-38-13, §40)</h3>
 *
 * The delta states its sentiment as a <b>word</b> ("better" / "worse" / "No change"), its
 * arithmetic direction as an <b>arrow</b>, and its sentiment again as <b>colour</b>. The word is
 * not redundancy for its own sake: this tile can legitimately show a teal accent beside a green
 * delta, and D-38-13 measured teal(182) at ΔE2000 **18.68** from `--success-600` — the closest
 * pair in the entire semantic set. Hue alone is the one channel a reader may confuse here.
 *
 * <p>Note the arrow means <i>direction</i> and the colour means <i>sentiment</i>; they disagree on
 * purpose for an inverted metric (food cost down = down arrow, green). The word is what resolves
 * the apparent contradiction for a reader, which is why it is visible text and not `sr-only`.
 *
 * <h3>The accent channel is decorative and may never be a state hue</h3>
 *
 * The demo ships six hues (gold/teal/blue/red/green/purple). This ships **two**: `primary` (gold)
 * and `secondary` (teal, and never spelled "teal" — `conformance-scan.ts:93` scores `bg-teal-*` as
 * a raw-palette offender). `globals.css` is explicit that the secondary ramp "MUST NOT carry state
 * meaning; success/warning/danger keep that job exclusively", and the converse binds just as hard:
 * a decorative rail painted `danger` would put a second, hand-picked state channel on a tile whose
 * real state channel is derived — reintroducing the demo's Food-Cost bug through the back door.
 * Blue and purple are dropped because `info` is a state token and no purple token exists.
 *
 * <p>This is also why `KpiTile`'s `tone` prop is <b>not</b> ported: it recolours the value itself
 * `destructive`/`warning` with no second channel, so an escalated tile and a calm one are
 * identical to a colour-blind manager. Escalation belongs to the delta, which carries a word.
 *
 * <h3>Zones — safe on `operational` by DEFAULT, richness opt-in (D-38-04)</h3>
 *
 * Designed for <b>`expressive`</b> (dashboards, reports, SuperAdmin, settings) and
 * <b>`restrained`</b> (back-office lists, forms, menu management). The default `surface="card"` is
 * an opaque card with a depth-1 shadow and no motion, so it is also safe on <b>`operational`</b>
 * (POS, KDS): no `backdrop-filter`, no entrance animation, no parallax, no tilt, no `transform` on
 * any ancestor of the receipt print path. `surface="glass"` opts into `glass-surface` + `vdl-lift`,
 * both of which the cascade gates to `[data-zone="expressive"]` on their own — so even the opt-in
 * degrades to an opaque card with a shadow-only hover if a POS screen ever imports it. D-38-04's
 * real failure mode is not glass on the POS, it is glass on a shared primitive the POS imports.
 *
 * <h3>Money</h3>
 *
 * `value` is a `ReactNode` so the caller passes `<MoneyDisplay paisa={…} />`. This file does not
 * import, wrap or format money — values are BIGINT paisa and `formatPaisa` is pinned against the
 * JVM renderer by a shared vector file (37-01). A tile that formatted its own money would be the
 * fourth place this product renders currency and the first that nobody pinned.
 *
 * <h3>Deliberately NOT built: compare-to-target (N9)</h3>
 *
 * Six demo stats render a third state — a progress bar against a target or budget
 * (`:667` "vs budget 30%", the HR headcount and CRM quota cards). There is **no target entity
 * anywhere in the backend** to hold one. Shipping the UI first means every caller invents a
 * literal, which is precisely the defect class D-38-16 exists to prevent, and the resulting
 * "82% of target" would be a number this system does not know. When a target entity exists, add
 * a `target` prop here — not a hardcoded bar in a screen.
 */

export type StatTileAccent = "none" | "primary" | "secondary";
export type StatTileSurface = "card" | "glass";
export type StatTileDensity = "comfortable" | "compact";

/** Same shape `status-badge.tsx` accepts, so a lucide icon passes without a cast. */
type StatTileIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

interface StatTileBaseProps {
  /** What the number is, in the reader's words. Rendered as the eyebrow at `--text-label`. */
  label: string;
  /**
   * The figure. A `ReactNode` so `<MoneyDisplay paisa={…} />`, an `<AnimatedNumber>` or a plain
   * string all compose. Ignored when {@link StatTileBaseProps.unavailableReason} is set.
   */
  value?: React.ReactNode;
  /**
   * Percentage change vs the prior period.
   *
   * <p>Three distinct meanings, and the distinction is the point:
   * <b>omitted</b> — no delta row at all (8 of the demo's 24 cards carry none, and that is correct
   * for a count like "Open POs"); <b>`null`</b> — there is a comparison to make but no comparable
   * prior period, rendered as a stated absence; <b>`0`</b> — measured, and it was flat.
   * `null` must never be coerced to `0`, which claims the business did not move.
   */
  deltaPct?: number | null;
  /** Whether an increase is good news. Food cost, waste and late tickets pass `false`. */
  higherIsBetter?: boolean;
  /** The comparison basis, in the demo's own words — "vs last Mon", "vs prior period". */
  comparisonLabel?: string;
  /**
   * Set when the figure genuinely cannot be computed from data this system holds. Renders `—`
   * plus this reason instead of the value, and suppresses the delta row. Say what is missing
   * ("no aggregate food-cost source"), not that something went wrong.
   */
  unavailableReason?: string;
  // NOTE: `value` and `unavailableReason` are narrowed into a discriminated union at the
  // exported `StatTileProps` below. They are optional HERE only so the two variants can
  // each require the right one. Do not consume `StatTileBaseProps` directly.
  /** Optional glyph for the tinted chip. Decorative — the label already names the metric. */
  icon?: StatTileIcon;
  /** Decorative hue. Never a state hue; see the docblock. */
  accent?: StatTileAccent;
  /** `card` (default) is safe in every zone. `glass` is the expressive opt-in. */
  surface?: StatTileSurface;
  /** Padding and gap only — the value stays at `--text-display` so it reads across a room. */
  density?: StatTileDensity;
  className?: string;
}

/**
 * Drill-through is all-or-nothing at the type level: a destination without a stated label is how
 * "click here" links get into an accessibility tree.
 */
type StatTileDrill =
  | { drillTo: string; drillLabel: string }
  | { drillTo?: undefined; drillLabel?: undefined };

/**
 * A StatTile either HAS a figure or states why it does not. It cannot do both, and it cannot
 * do neither (D-38-16, D-38-20).
 *
 * <p>Before this narrowing, `value` was required and `unavailableReason` was a free-floating
 * optional beside it — so a caller with no data had to invent a `value` anyway, and nothing in
 * the type system stopped a fabricated number. `Meter` already got this right with a union;
 * the review found the two primitives disagreeing about the same problem, which is what
 * happens when they are built by agents who cannot see each other's work.
 *
 * <p>This matters more here than anywhere else in the product: 17 of the demo's headline
 * figures have no honest source in this system, and the whole of D-38-16 is that such a figure
 * renders as a stated absence rather than as a number. The compiler now enforces it.
 */
export type StatTileProps = StatTileBaseProps & StatTileDrill & (
  | { value: React.ReactNode; unavailableReason?: never }
  | { value?: never; unavailableReason: string }
);

type Sentiment = "better" | "worse" | "flat" | "unknown";

/** Polarity, computed once. The caller states what the metric means; it does not pick a colour. */
function sentimentOf(deltaPct: number | null | undefined, higherIsBetter: boolean): Sentiment {
  if (deltaPct === undefined || deltaPct === null) return "unknown";
  if (deltaPct === 0) return "flat";
  return deltaPct > 0 === higherIsBetter ? "better" : "worse";
}

const SENTIMENT_CLASS: Record<Sentiment, string> = {
  better: "text-success",
  worse: "text-destructive",
  flat: "text-foreground-tertiary",
  unknown: "text-foreground-tertiary",
};

const ACCENT_RAIL: Record<StatTileAccent, string> = {
  // The demo's 2px gradient rail (`:424-432`). A FILL, so it takes `--primary-solid` (gold in
  // both themes) rather than `--primary`, which is the text/link role and renders bronze in light.
  none: "",
  primary: "bg-linear-to-r from-primary-solid to-transparent",
  // The teal ramp has no bare semantic alias — `--secondary` is the neutral chip colour from
  // shadcn, not the accent. `secondary-400` is the stop D-38-12 anchored on the demo's #2DD4BF.
  secondary: "bg-linear-to-r from-secondary-400 to-transparent",
};

const ACCENT_CHIP: Record<StatTileAccent, string> = {
  none: "bg-muted text-foreground-secondary",
  // A TINT, so it correctly keeps `--primary` (D-38-18).
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary-400/15 text-secondary-700 dark:text-secondary-400",
};

export function StatTile({
  label,
  value,
  deltaPct,
  higherIsBetter = true,
  comparisonLabel,
  unavailableReason,
  icon: Icon,
  accent = "none",
  surface = "card",
  density = "comfortable",
  drillTo,
  drillLabel,
  className,
}: StatTileProps) {
  const unavailable = unavailableReason !== undefined;
  // A delta on a number we do not have is a second claim stacked on a withheld one.
  const showDelta = !unavailable && deltaPct !== undefined;
  const sentiment = sentimentOf(deltaPct, higherIsBetter);
  // The ARROW is arithmetic direction; the COLOUR is sentiment. They disagree for an inverted
  // metric, and that is correct — `deltaText` writes the word that reconciles them.
  const TrendIcon =
    deltaPct === undefined || deltaPct === null || deltaPct === 0
      ? Minus
      : deltaPct > 0
        ? TrendingUp
        : TrendingDown;

  return (
    <article
      // Named for screen readers so a grid of tiles is navigable as a set of stats rather than
      // as a wall of loose paragraphs. `aria-label` and not `aria-labelledby`, because generating
      // an id needs `useId`, and a hook would force "use client" onto a component that has no
      // interactivity and should stay renderable from a server route.
      aria-label={label}
      data-slot="stat-tile"
      data-accent={accent}
      data-surface={surface}
      data-density={density}
      data-unavailable={unavailable ? "true" : undefined}
      className={cn(
        // `overflow-hidden` clips the 2px rail to the card's radius. It also clips outlines
        // (measured, globals.css:908) — harmless here because the only focusable child is the
        // drill link, which sits inside 16px of padding and its 2+2px outline cannot reach the
        // edge. Do not move the link flush to the border without revisiting this.
        "group relative flex flex-col overflow-hidden rounded-xl",
        surface === "glass"
          ? // Both classes gate themselves to `[data-zone="expressive"]` in the cascade: outside
            // it, `glass-surface` is its opaque base declaration and `vdl-lift` resolves to a
            // shadow-only acknowledgement. The opt-in degrades; it does not leak.
            "glass-surface vdl-lift"
          : "border border-border bg-card text-card-foreground shadow-depth-1",
        density === "compact" ? "gap-1 p-(--space-sm)" : "gap-1.5 p-(--space-md)",
        className,
      )}
    >
      {accent !== "none" && (
        <span
          aria-hidden="true"
          data-slot="stat-tile-rail"
          className={cn("pointer-events-none absolute inset-x-0 top-0 h-0.5", ACCENT_RAIL[accent])}
        />
      )}

      {Icon && (
        <span
          data-slot="stat-tile-icon"
          className={cn(
            "mb-(--space-xs) flex size-9 shrink-0 items-center justify-center rounded-lg",
            ACCENT_CHIP[accent],
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      )}

      <p
        data-slot="stat-tile-label"
        className="text-label font-medium tracking-wider text-foreground-tertiary uppercase"
      >
        {label}
      </p>

      {unavailable ? (
        <>
          {/* The dash is a typographic placeholder, not information — the reason below is the
              information, so a screen reader is given the reason and not a lone punctuation mark. */}
          <p
            aria-hidden="true"
            data-slot="stat-tile-value"
            className="font-heading text-display font-semibold tabular-nums text-foreground-tertiary"
          >
            —
          </p>
          <p data-slot="stat-tile-unavailable" className="text-small text-foreground-tertiary">
            {unavailableReason}
          </p>
        </>
      ) : (
        <p
          data-slot="stat-tile-value"
          className="font-heading text-display font-semibold tabular-nums"
        >
          {value}
        </p>
      )}

      {showDelta && (
        <p
          data-slot="stat-tile-delta"
          data-sentiment={sentiment}
          className={cn(
            "inline-flex flex-wrap items-center gap-1 text-label font-semibold tabular-nums",
            SENTIMENT_CLASS[sentiment],
          )}
        >
          <TrendIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{deltaText(deltaPct, sentiment)}</span>
          {comparisonLabel && (
            <span className="font-normal text-foreground-tertiary">{comparisonLabel}</span>
          )}
        </p>
      )}

      {drillTo && (
        <Link
          href={drillTo}
          data-slot="stat-tile-drill"
          // The `after` overlay makes the whole card clickable while the accessibility tree still
          // holds exactly ONE link with a stated destination. That is the part `PortletShell`'s
          // whole-card `<Link>` cannot offer a caller who has no destination at all.
          className="mt-(--space-xs) inline-flex w-fit items-center gap-1 text-small font-medium text-primary after:absolute after:inset-0 after:content-['']"
        >
          {drillLabel}
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}

/**
 * The sentiment WORD, not just a sign. "−1.2% better" is a falling food cost; the demo renders the
 * identical figure red on one screen and green on another because a word was never written down.
 */
function deltaText(deltaPct: number | null | undefined, sentiment: Sentiment): string {
  if (deltaPct === null || deltaPct === undefined) return "No comparable prior period";
  if (deltaPct === 0) return "No change";
  const signed = `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
  return `${signed} ${sentiment === "better" ? "better" : "worse"}`;
}

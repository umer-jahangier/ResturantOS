import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronUp, Minus } from "lucide-react";

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
 * <h3>Three channels on the delta, not one (D-38-13, UI-SPEC §4.2, §40)</h3>
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
 * <p><b>And `components/ui/activity-row.tsx` now says the same thing, because it used to say the
 * opposite.</b> Two primitives from this wave were reviewed together and found disagreeing:
 * `ActivityRow` rendered its severity word `sr-only`, leaving a sighted reader with a
 * colour-vision deficiency nothing but the chip hue and a caller-supplied glyph that is <i>not</i>
 * derived from the tone — so two different severities were free to render identically. UI-SPEC
 * §4.2 requires state carried by hue to ALSO be carried by text, shape or icon, <b>visibly</b>,
 * and `sr-only` reaches only the reader who was never at risk from hue in the first place.
 *
 * <p>The settled rule, binding on both files: <b>hue never travels alone, and the second channel
 * is on the screen.</b> Neither primitive offers a prop that can switch it off — this tile's
 * delta word is unconditional, and over there the empty `toneLabel` that used to delete the tone
 * word now falls back to it. Change one of these two files and change the other; the agreement is
 * pinned from `__tests__/components/ui/activity-row.test.tsx` so a third reader does not have to
 * re-litigate it.
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
 * <p><b>The rail is opt-in per CALL SITE, and today no call site takes it.</b> All 24 of the
 * demo's KPI cards carry a hue; ours default to `accent="none"` and therefore to a flat top edge,
 * which is why the strip reads plainer than the demo's even though the device is implemented
 * here. That is a screen-level gap, not a primitive one — every screen that renders a KPI strip
 * owes its tiles an `accent`. Do not "fix" it by defaulting to `primary`: a strip of four
 * identically-gold rails is not what the demo does either, and the hue is supposed to say which
 * metric family this is.
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
  // NOTE: `deltaPct`, `higherIsBetter` and `comparisonLabel` are NOT declared here. They live in
  // {@link StatTileDelta} below, which binds the two polarity props to the delta they describe.
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
 * The delta and its two modifiers travel together, or none of them is accepted at all.
 *
 * <h3>What this union is repairing</h3>
 *
 * <p>`higherIsBetter` and `comparisonLabel` describe a delta. Nothing else on the tile reads
 * them: `showDelta` is `!unavailable && deltaPct !== undefined`, so with no `deltaPct` the
 * sentiment, the arrow, the word and the comparison basis are all unreachable. They were
 * declared as free-floating optionals beside `deltaPct` anyway — and the product duly filled
 * them in. **Nine** call sites passed `higherIsBetter={false}` (purchasing/purchase-orders,
 * purchasing/payments ×2, inventory/stock ×2, inventory/coverage, hr/attendance ×2, hr/payroll)
 * and not one of them passed a delta, so nine screens declared a polarity that could not render
 * and no compiler said a word. A prop that has no effect is not harmless: it reads to the next
 * author as evidence that the tile is doing something with it, and the natural "fix" for a
 * polarity that never shows up is to invent the delta that would make it show up.
 *
 * <h3>Why the props were removed from the call sites rather than fed a delta</h3>
 *
 * <p>Because none of those nine metrics has an honest prior period. They are counts of the
 * CURRENT state — orders awaiting approval, ingredients below reorder point, late minutes
 * today — and this system stores no historical snapshot of any of them. The only prior-period
 * figure the backend actually computes is the purchasing spend comparison
 * (`apiSpendBucketSchema.priorSpendPaisa`/`deltaPct`), and that already renders through
 * `SpendAnalyticsTable`. Manufacturing a percentage for the other nine would be D-38-16's exact
 * defect one level up: not a fabricated value, but a fabricated CHANGE in a value.
 *
 * <p>So the delta subsystem stays — it is specified, tested, and the first caller with a real
 * prior period gets computed polarity for free — and the type now refuses the state where a
 * polarity is asserted with nothing to apply it to. Same instinct as the `value` /
 * `unavailableReason` union below: make the wrong shape uncompilable rather than documented.
 */
type StatTileDelta =
  | {
      /**
       * Percentage change vs the prior period.
       *
       * <p>Two distinct meanings once the prop is present, and the distinction is the point:
       * <b>`null`</b> — there is a comparison to make but no comparable prior period, rendered as
       * a stated absence; <b>`0`</b> — measured, and it was flat. `null` must never be coerced to
       * `0`, which claims the business did not move. Omitting the prop entirely is the third
       * meaning: no delta row at all, which is correct for a count like "Open POs" (8 of the
       * demo's 24 cards carry none) — and that case is the second member of this union.
       */
      deltaPct: number | null;
      /** Whether an increase is good news. Food cost, waste and late tickets pass `false`. */
      higherIsBetter?: boolean;
      /** The comparison basis, in the demo's own words — "vs last Mon", "vs prior period". */
      comparisonLabel?: string;
    }
  | { deltaPct?: undefined; higherIsBetter?: never; comparisonLabel?: never };

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
export type StatTileProps = StatTileBaseProps &
  StatTileDrill &
  StatTileDelta &
  (
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
  // The GLYPH is arithmetic direction; the COLOUR is sentiment. They disagree for an inverted
  // metric, and that is correct — `deltaText` writes the word that reconciles them.
  //
  // A CHEVRON, not `TrendingUp`/`TrendingDown`. The demo draws a bare 12px chevron
  // (`DEMO-COMPONENTS.md:410` — `polyline points="18 15 12 9 6 15"`), and the lucide trend icons
  // are a different object: a multi-segment polyline with an arrowhead, which at 14px reads as a
  // sparkline sitting beside a number that is not a sparkline. The chevron is the direction and
  // nothing else, which is all this row is allowed to claim.
  const TrendIcon =
    deltaPct === undefined || deltaPct === null || deltaPct === 0
      ? Minus
      : deltaPct > 0
        ? ChevronUp
        : ChevronDown;

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
        // drill link, which sits inside 20px of padding and its 2+2px outline cannot reach the
        // edge. Do not move the link flush to the border without revisiting this.
        "group relative flex flex-col overflow-hidden rounded-xl",
        surface === "glass"
          ? // Both classes gate themselves to `[data-zone="expressive"]` in the cascade: outside
            // it, `glass-surface` is its opaque base declaration and `vdl-lift` resolves to a
            // shadow-only acknowledgement. The opt-in degrades; it does not leak.
            "glass-surface vdl-lift"
          : // The demo's `.kpi-card:hover` (`DEMO-COMPONENTS.md:402`) lifts the border to
            // `--border-2` — and `DEMO-TOKENS.md` §3c records the general rule it belongs to:
            // "Hover on a card changes BORDER COLOUR only". Ours acknowledged a pointer with
            // nothing at all, which is a large part of why a strip of tiles reads as printed
            // rather than as a surface.
            //
            // Colour only, deliberately: the demo pairs this with `translateY(-1px)` and
            // `--shadow`, and neither is taken here. A transform on a shared primitive is the
            // exact hazard `receipt-print.css` guards (a containing block for the `position:
            // fixed` bill) and `vdl-lift` is pinned OFF for this surface by
            // `stat-tile.test.tsx:279`. A hover that is one hairline shade is a depth cue, which
            // is all the operational zone permits and all this device actually needed.
            "border border-border bg-card text-card-foreground shadow-depth-1 transition-colors hover:border-border-strong",
        // 20px / 16px, which is the demo's `.card` / `.card-sm` pair verbatim
        // (`DEMO-COMPONENTS.md:373-377`). It used to be 16px / 8px, and the 8px was the
        // "cheap" verdict in miniature: a 30px serif numeral sitting 8px from a hairline reads
        // as a number that fell into a box rather than one that was placed in it. Nothing in the
        // product passed `density="compact"` when this changed, so the compact rung is a
        // widening with no call site behind it.
        //
        // `p-5` and not `p-(--space-*)`: the space ladder is 4/8/16/24/32 and has no 20px rung.
        // Reported upward as a token request (`--space-card: 20px`) rather than invented here —
        // this file does not own `globals.css`.
        density === "compact" ? "gap-1 p-(--space-md)" : "gap-1.5 p-5",
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
            // 40px chip, 18px glyph. The demo measures 36/18; the target spec asks for ~40, and
            // 40 is the better number here because our icon set is lucide at a 1.5 stroke rather
            // than the demo's hand-drawn 1.8 — the lighter glyph needs the extra 2px of ground on
            // each side to read as a chip rather than as an icon with a tint behind it.
            //
            // `rounded-lg` — 8px — is the demo's own `.kpi-icon` radius (`DEMO-COMPONENTS.md:436`)
            // and, more importantly, its NESTING rule: `DEMO-TOKENS.md` §3b measures "a card at
            // 16px never contains anything rounder than 8px". `rounded-xl` (11.2px here) put the
            // chip's corner within 3px of the card's, which is what makes a tile read as two
            // stacked blobs rather than as an object placed inside a panel.
            //
            // `mb-1.5` and not `mb-(--space-xs)`: this is a flex column at `gap-1.5`, so 6px of
            // margin plus the 6px gap is the demo's measured 12px of ground under the chip
            // (`.kpi-icon { margin-bottom: 12px }`). 4px was 10px of total separation — the chip
            // sat ON the label rather than above it.
            "mb-1.5 flex size-10 shrink-0 items-center justify-center rounded-lg",
            // The chip keeps its accent even when the figure is unavailable, and this is the
            // deliberate half of "considered rather than broken": an unavailable tile sits in a
            // strip of four, and greying its chip and rail would punch a visible HOLE in the row
            // — which reads as a rendering failure, not as a stated absence. Every device that
            // says "this tile belongs here" stays; the one thing that changes is that the figure
            // is replaced by a ruled-off sentence explaining why there isn't one.
            ACCENT_CHIP[accent],
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      )}

      {/*
       * SENTENCE case, and the demo's `.kpi-label` metrics exactly: 11px / 500 / 0.05em
       * (`DEMO-COMPONENTS.md:453` — `font-size: 11px; color: var(--text-3); font-weight: 500;
       * letter-spacing: 0.05em`).
       *
       * <p><b>Sentence case, but not untracked.</b> This used to be an 11px UPPERCASE
       * letterspaced eyebrow, which put the tile's label in the SAME voice as the card section
       * header above it (`CardEyebrow`) — so a KPI strip inside a card read as two ranks of
       * small-caps stacked on each other and the hierarchy flattened. The demo keeps them apart
       * deliberately: `.card-title` is uppercase/0.08em and `.kpi-label` is plain sentence case
       * (no `text-transform`). The eyebrow names the SECTION; the label names the METRIC.
       *
       * <p>The over-correction was dropping the TRACKING with the uppercase. The demo tracks this
       * line at 0.05em and sets it at 11px/500 — and the two decisions are one decision: a label
       * is legible at 11px BECAUSE it is opened up, and a tracked 11px line reads as a caption
       * for the numeral beneath it where an untracked 13px line reads as the first line of a
       * paragraph that happens to be above a big number. That is the whole difference between a
       * KPI and a `<div>` with text in it, and it was the shipped rendering.
       *
       * <p>`tracking-wider` IS 0.05em on Tailwind's stock ladder — the same utility
       * `activity-row.tsx` puts on its severity tag, so the two small-type devices agree. The two
       * declared tracking tokens are 0.12em (`--tracking-eyebrow`) and 0.08em
       * (`--tracking-brandmark`); neither is this value, and a `--tracking-label: 0.05em` role
       * has been reported upward rather than invented here.
       */}
      <p
        data-slot="stat-tile-label"
        className="text-label font-medium tracking-wider text-foreground-secondary"
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
            className="font-heading text-display leading-none font-semibold tabular-nums text-foreground-tertiary"
          >
            —
          </p>
          {/* The dashed hairline is `Meter`'s established rendering for a track with no honest
              reading (`meter.tsx`, `border-dashed` on the unknown track). Reusing it here makes
              the absence look ISSUED rather than broken — a deliberately ruled-off note, which is
              what an unavailable figure is — and it costs no new vocabulary. */}
          <p
            data-slot="stat-tile-unavailable"
            className="mt-(--space-xs) border-t border-dashed border-border pt-(--space-xs) text-small text-foreground-tertiary"
          >
            {unavailableReason}
          </p>
        </>
      ) : (
        <p
          data-slot="stat-tile-value"
          className="font-heading text-display leading-none font-semibold tabular-nums"
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

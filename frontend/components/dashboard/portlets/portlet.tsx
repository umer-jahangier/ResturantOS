"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Info,
  Minus,
} from "lucide-react";

import { T_BODY, T_DISPLAY, T_H2, T_LABEL, T_SMALL } from "@/components/dashboard/dashboard-type";
import { ActivityFeed, ActivityRow } from "@/components/ui/activity-row";
import { Meter, type MeterFormat, type MeterStatus } from "@/components/ui/meter";
import { cn } from "@/lib/utils";

/**
 * The metric hue a portlet is drawn in.
 *
 * <h3>Why a portlet needs seven where `StatTile` needs three</h3>
 *
 * `components/ui/stat-tile.tsx` offers `none | primary | secondary`, which is right for the back
 * office: a purchasing screen's stat row is one subject in one colour, and a wider palette there
 * would be decoration. A DASHBOARD is the opposite case — the demo's KPI row is four DIFFERENT
 * subjects side by side (`DEMO-COMPONENTS.md`, the `.kpi-card` recipe: "background = the metric's
 * hue at ~10% alpha, icon in the full-strength hue"), and four tiles in one hue is exactly the
 * flat read the product owner rejected. So the ladder is widened HERE, at the dashboard, rather
 * than in the shared primitive that has no use for it.
 *
 * <p>Every entry is a token role, never a palette literal: fills take the `-solid`/ramp stop that
 * is legible in both themes, tints take the semantic alias at low alpha (D-38-18).
 */
export type PortletAccent =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

export type PortletIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/**
 * The 2px gradient rail across the top edge (`DEMO-COMPONENTS.md` — the `.kpi-card::before`
 * recipe). A FILL, so it takes `--primary-solid` (gold in both themes) rather than `--primary`,
 * which is the text/link role and renders bronze on a light ground.
 *
 * <p>It fades to transparent at the right-hand end rather than running edge to edge, which is
 * what stops four rails in a row reading as a striped table header.
 */
const ACCENT_RAIL: Record<PortletAccent, string> = {
  primary: "bg-linear-to-r from-primary-solid to-transparent",
  secondary: "bg-linear-to-r from-secondary-400 to-transparent",
  success: "bg-linear-to-r from-success to-transparent",
  warning: "bg-linear-to-r from-warning to-transparent",
  danger: "bg-linear-to-r from-destructive to-transparent",
  info: "bg-linear-to-r from-info to-transparent",
  neutral: "bg-linear-to-r from-border to-transparent",
};

/** The 40px icon chip: the hue at ~10% alpha behind the glyph at full strength. A TINT. */
const ACCENT_CHIP: Record<PortletAccent, string> = {
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary-400/15 text-secondary-700 dark:text-secondary-400",
  success: "bg-success/10 text-success",
  // `warning` at full strength fails on a light ground; the 700/400 pair is the measured one
  // `activity-row.tsx` already uses, so the two feeds agree rather than each picking a stop.
  warning: "bg-warning/15 text-warning-700 dark:text-warning-400",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-muted text-foreground-secondary",
};

/** The proportional bar in a ranked list, in the same hue as the card it sits in. */
const ACCENT_BAR: Record<PortletAccent, string> = {
  primary: "bg-primary-solid",
  secondary: "bg-secondary-400",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-foreground-tertiary",
};

/**
 * The small-caps eyebrow the demo puts above every panel — "RECENT TRANSACTIONS",
 * "LIVE OPERATIONS", "TOP MENU ITEMS TODAY".
 *
 * <p>`.08em`, not `tracking-wide` (`.025em`). That gap is most of the difference between a
 * heading that looks typeset and one that looks defaulted, and it is the number the demo
 * actually carries.
 */
const EYEBROW = "font-semibold uppercase tracking-[0.08em] text-foreground-secondary";

interface PortletShellProps {
  id: string;
  title?: string;
  drillTo: string;
  drillLabel: string;
  density: "comfortable" | "compact";
  /** Paints the top rail. Every card in the demo carries one; `neutral` is the quiet version. */
  accent?: PortletAccent;
  /** Stamps `data-unavailable` so a refused figure is styleable and assertable as one state. */
  unavailable?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * The card every portlet is drawn on.
 *
 * <p>The WHOLE card is the drill target (§7.3: "a KPI you cannot click is a poster, not a
 * dashboard"), which is the one structural difference from `components/ui/stat-tile.tsx` — that
 * primitive puts an optional link INSIDE the card, because a back-office stat often has nowhere
 * to go. Both shapes are correct for their own surface, and this is the note that stops a future
 * reader "unifying" them: collapsing the portlet into `StatTile` moves the anchor off the card,
 * and every dashboard test that asserts `[data-portlet]` is a link with an `href` is asserting
 * that §7.3 still holds.
 *
 * <p>`overflow-hidden` clips the 2px rail to the card's radius. It clips DESCENDANT outlines, not
 * this element's own — the focus ring on the card is drawn outside its border box by its own
 * ancestor chain — so the drill target stays visibly focusable. Do not add a focusable child
 * flush to an edge without revisiting that.
 */
export function PortletShell({
  id,
  title,
  drillTo,
  drillLabel,
  density,
  accent = "neutral",
  unavailable,
  className,
  style,
  children,
}: PortletShellProps) {
  return (
    <Link
      href={drillTo}
      data-portlet={id}
      data-testid={`portlet-${id}`}
      data-accent={accent}
      data-unavailable={unavailable ? "true" : undefined}
      aria-label={drillLabel}
      style={style}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl text-card-foreground",
        "glass-surface shadow-depth-2 vdl-lift",
        density === "compact" ? "gap-1.5 p-4" : "gap-2.5 p-5",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="portlet-rail"
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-0.5", ACCENT_RAIL[accent])}
      />
      {title && (
        <div className="flex items-start justify-between gap-2">
          <h3 className={cn(EYEBROW, T_LABEL)}>{title}</h3>
          {/* The drill affordance. Present at 25% so the card never looks inert, full on hover. */}
          <ArrowUpRight
            className={cn(
              "size-3.5 shrink-0 text-foreground-tertiary opacity-25 transition-opacity",
              "group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
            aria-hidden="true"
          />
        </div>
      )}
      {children}
    </Link>
  );
}

export interface PortletChromeProps {
  id: string;
  title: string;
  drillTo: string;
  density: "comfortable" | "compact";
  style?: React.CSSProperties;
}

/**
 * A delta is a claim about CHANGE, so its polarity travels with it.
 *
 * `higherIsBetter` alone is inert — it describes a comparison that is not being made — and the
 * union refuses that shape at compile time rather than rendering a green chip on a metric where
 * up is bad.
 */
type KpiTileDelta =
  | {
      deltaPct: number | null;
      higherIsBetter?: boolean;
      /** "vs the 30 days before", "vs budget". Defaults to the neutral "vs prior". */
      comparisonLabel?: string;
    }
  | { deltaPct?: undefined; higherIsBetter?: never; comparisonLabel?: never };

/**
 * D-38-16 as a type: a figure this system cannot compute renders as a stated absence, and a tile
 * cannot express "a value AND a reason". The shape that used to ship — `value="—"` beside a
 * conditional `unavailableReason` — made the literal dash the tile's live VALUE on any render
 * where the reason came back undefined.
 */
type KpiTileFigure =
  | {
      value: React.ReactNode;
      unavailableReason?: never;
    }
  | {
      value?: never;
      unavailableReason: string;
    };

interface KpiTileBody {
  caption: string;
  spark?: number[];
  /** Colours the VALUE, for a figure that is itself an alarm (late tickets, out of stock). */
  tone?: "neutral" | "warning" | "danger";
  /** Colours the RAIL and the icon chip — the metric's identity, not its current state. */
  accent?: PortletAccent;
  /** The demo's 18px glyph inside the 40px chip. Absent, the chip is not drawn at all. */
  icon?: PortletIcon;
}

export type KpiTileData = KpiTileBody & KpiTileDelta & KpiTileFigure;
export type KpiTileProps = PortletChromeProps & KpiTileData;

/**
 * The KPI tile — the most repeated object on any dashboard, and the one that carried none of the
 * demo's devices.
 *
 * <h3>What changed in phase 38, and what each change buys</h3>
 *
 * <ul>
 *   <li><b>The value is set in the display serif at 30px.</b> `font-heading` + `--text-display`
 *       is the same pairing `StatTile` uses, and it is the single line that makes a number look
 *       designed rather than defaulted.</li>
 *   <li><b>A 2px gradient rail and a 40px icon chip in the metric's hue.</b> Four tiles that
 *       differ only in their text are four tiles a reader has to READ; four tiles that differ in
 *       hue and glyph are four tiles they can find.</li>
 *   <li><b>A chevron, not `TrendingUp`.</b> The lucide trend icons are multi-segment polylines
 *       with an arrowhead, and at 14px beside a number they read as a sparkline that is not a
 *       sparkline. The chevron is direction and nothing else, which is all this row claims.</li>
 *   <li><b>The refusal is styled.</b> A withheld figure used to be a grey dash and a sentence,
 *       which reads as a bug. It now carries its own "NO FIGURE" chip and a dashed rule, so the
 *       absence looks like a decision — which is what D-38-16 says it is.</li>
 * </ul>
 */
export function KpiTile({
  id,
  title,
  drillTo,
  density,
  style,
  value,
  caption,
  deltaPct,
  higherIsBetter = true,
  comparisonLabel = "vs prior",
  spark,
  unavailableReason,
  tone = "neutral",
  accent = "primary",
  icon: Icon,
}: KpiTileProps) {
  const unavailable = unavailableReason !== undefined;
  // The GLYPH is arithmetic direction; the COLOUR is sentiment. They disagree for an inverted
  // metric, and that is correct.
  const good = deltaPct == null ? null : higherIsBetter ? deltaPct >= 0 : deltaPct <= 0;
  const DeltaIcon = deltaPct == null ? Minus : deltaPct >= 0 ? ChevronUp : ChevronDown;
  // A refused figure gets the quiet rail: a gold rail over an em dash advertises a number that
  // is not there.
  const railAccent: PortletAccent = unavailable ? "neutral" : accent;

  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open details`}
      density={density}
      accent={railAccent}
      unavailable={unavailable}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {unavailable ? (
            <>
              <p
                className={cn(
                  "font-heading font-semibold tabular-nums text-foreground-tertiary",
                  T_DISPLAY,
                )}
                data-testid={`kpi-value-${id}`}
              >
                {"—"}
              </p>
              <span
                data-slot="kpi-no-figure"
                className={cn(
                  "w-fit rounded-full border border-dashed border-border px-2 py-0.5",
                  "font-semibold tracking-[0.08em] uppercase text-foreground-tertiary",
                  T_LABEL,
                )}
              >
                No figure
              </span>
            </>
          ) : (
            <>
              <p
                className={cn(
                  "font-heading font-semibold tabular-nums",
                  T_DISPLAY,
                  /*
                   * `text-destructive` / the warning INK pair — never `-foreground`.
                   *
                   * This read `text-warning-foreground`, and the sibling delta below read
                   * `text-success-foreground`. Those two tokens are the colour of text drawn ON a
                   * warning or success FILL, and `globals.css:596-599` / `:874-877` set them to
                   * `--neutral-950`/`--neutral-0` in light and `--neutral-1000` in BOTH roles in
                   * dark. Used as ink on a card they resolve to near-white on a white surface in
                   * light and near-black on a near-black surface in dark: the figure and its delta
                   * were invisible in both themes, which a screenshot of the rendered tile shows
                   * immediately and no test in this repo was looking for. The `700 / dark:400`
                   * pair is the measured one `activity-row.tsx` already uses.
                   */
                  tone === "danger" && "text-destructive",
                  tone === "warning" && "text-warning-700 dark:text-warning-400",
                )}
                data-testid={`kpi-value-${id}`}
              >
                {value}
              </p>
              <p className={cn("text-foreground-secondary", T_SMALL)}>{caption}</p>
              {deltaPct !== undefined && (
                <p
                  className={cn(
                    "inline-flex items-center gap-1 font-medium tabular-nums",
                    T_SMALL,
                    good === null
                      ? "text-foreground-tertiary"
                      : good
                        ? "text-success"
                        : "text-destructive",
                  )}
                  data-testid={`kpi-delta-${id}`}
                >
                  <DeltaIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  {deltaPct == null ? (
                    "No comparable prior period"
                  ) : (
                    <>
                      {`${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
                      <span className="font-normal text-foreground-tertiary">
                        {comparisonLabel}
                      </span>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        {Icon && (
          <span
            aria-hidden="true"
            data-slot="portlet-chip"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              ACCENT_CHIP[unavailable ? "neutral" : accent],
            )}
          >
            <Icon className="size-4.5" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* The reason, not a zero. "0%" here would be an assertion about the business. */}
      {unavailable && (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{unavailableReason}</p>
      )}

      {!unavailable && spark && spark.length > 1 && <Sparkline values={spark} accent={accent} />}
    </PortletShell>
  );
}

/**
 * 100×20 of shape, no axis and no labels — it says "rising, then a dip", which is all a 20px
 * strip can honestly say. The area wash under it is the demo's, and it is what stops a
 * hairline polyline reading as a stray border.
 */
function Sparkline({ values, accent }: { values: number[]; accent: PortletAccent }) {
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${20 - (v / max) * 18}`)
    .join(" ");
  const stroke = accent === "secondary" ? "var(--chart-2)" : "var(--chart-1)";
  return (
    <svg viewBox="0 0 100 20" className="h-5 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,20 ${points} 100,20`} fill={stroke} fillOpacity="0.12" />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export interface RankedRow {
  key: string;
  label: string;
  value: React.ReactNode;
  /**
   * OPTIONAL, and the omission is load-bearing: no fraction, no bar. A bar drawn for a row with
   * nothing to encode is decoration that reads as data — `manager-86d` is the case that proved
   * it, where every 86'd item drew a full-width bar meaning nothing.
   */
  fraction?: number;
}

export interface RankedListData {
  rows: RankedRow[];
  emptyLabel: string;
  /** The hue of the card and of its bars. */
  accent?: PortletAccent;
  /**
   * Whether the trailing value is a FIGURE. Amounts and quantities are set in DM Mono, per the
   * demo's table rule; a word is not. `manager-86d` trails a menu CATEGORY ("Mains", "Drinks")
   * and setting that in mono makes a label look like a stock code.
   */
  monoValue?: boolean;
}

/**
 * A ranked table — the demo's "TOP MENU ITEMS TODAY".
 *
 * The rank ordinal is set in DM Mono, which is the demo's rule for references and figures inside
 * a table, and it is what turns a bulleted list into a leaderboard.
 */
export function RankedList({
  id,
  title,
  drillTo,
  density,
  style,
  rows,
  emptyLabel,
  accent = "primary",
  monoValue = true,
}: PortletChromeProps & RankedListData) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
      accent={accent}
      style={style}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{emptyLabel}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-col gap-1.5">
              <div className={cn("flex items-baseline justify-between gap-2", T_BODY)}>
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "shrink-0 font-mono tabular-nums text-foreground-tertiary",
                      T_LABEL,
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate font-medium">{row.label}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-foreground-secondary",
                    monoValue && "font-mono tabular-nums",
                  )}
                >
                  {row.value}
                </span>
              </div>
              {row.fraction !== undefined && (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                  aria-hidden="true"
                >
                  <div
                    className={cn("h-full rounded-full", ACCENT_BAR[accent])}
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

/**
 * One line of a meter stack — the demo's "LIVE OPERATIONS" panel: a label, a figure against the
 * thing it is measured against, and a track.
 *
 * <p>`of` is REQUIRED and is never a made-up 100. That is the whole point of using
 * `components/ui/meter.tsx` here: it refuses to draw a fill without a real denominator and says
 * so in words ("No denominator to measure against") rather than rendering an empty track that
 * looks like a zero.
 */
export interface MeterStackRow {
  key: string;
  label: string;
  value: number | null;
  of: number;
  format?: MeterFormat;
  noun?: string;
  currency?: string;
  status?: MeterStatus;
  /** Required when `value` is null — the stated absence, in this row's own words. */
  unavailableReason?: string;
}

export interface MeterStackData {
  rows: MeterStackRow[];
  emptyLabel: string;
}

/** The demo's `2fr 1fr` right-hand column: four meters, each against a real denominator. */
export function MeterStack({
  id,
  title,
  drillTo,
  density,
  style,
  rows,
  emptyLabel,
  accent = "secondary",
}: PortletChromeProps & MeterStackData & { accent?: PortletAccent }) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
      accent={accent}
      style={style}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.key}>
              {row.value === null ? (
                <Meter
                  label={row.label}
                  value={null}
                  of={row.of}
                  format={row.format}
                  noun={row.noun}
                  currency={row.currency}
                  unavailableReason={
                    row.unavailableReason ?? "This figure has no source in this system."
                  }
                />
              ) : (
                <Meter
                  label={row.label}
                  value={row.value}
                  of={row.of}
                  format={row.format}
                  noun={row.noun}
                  currency={row.currency}
                  status={row.status}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </PortletShell>
  );
}

export interface ExceptionRow {
  key: string;
  label: string;
  detail: React.ReactNode;
  severity: "info" | "warning" | "danger";
  /**
   * The domain glyph. `severity` supplies the WORD and the HUE; the caller supplies the SHAPE,
   * because "a till is uncounted" and "a ticket is late" are the same severity and a reader
   * scanning the feed is looking for the shape. Defaults to a severity glyph when omitted.
   */
  icon?: React.ReactNode;
  /** Right-pinned relative age — "12m", "3h 52m". Omitted where the row has no instant at all. */
  timeLabel?: string;
  /** The machine-readable instant behind `timeLabel`, so the age is a real `<time>`. */
  dateTime?: string;
}

export interface ExceptionListData {
  rows: ExceptionRow[];
  emptyLabel: string;
}

const SEVERITY_TONE = {
  danger: "danger",
  warning: "warning",
  info: "info",
} as const;

/**
 * The uppercase triage word. It is VISIBLE text, not `sr-only` — settled in
 * `__tests__/components/ui/activity-row.test.tsx`, because hue is the one channel a reader with
 * a colour-vision deficiency cannot use, and the glyph is the caller's and not derived from
 * severity.
 */
const SEVERITY_WORD = {
  danger: "ACT",
  warning: "CHECK",
  info: "FYI",
} as const;

const SEVERITY_ICON = {
  danger: <AlertTriangle />,
  warning: <CircleAlert />,
  info: <Info />,
} as const;

/**
 * The alerts feed — the demo's third panel.
 *
 * <p>It is now `ActivityFeed`/`ActivityRow` (`components/ui/activity-row.tsx`) rather than a
 * hand-rolled list, which buys three things this panel did not have: a hue-tinted icon chip per
 * row, a right-pinned relative time, and row hairlines. All three are in the demo and none of
 * them were here; what was here was a coloured word in a rounded box, repeated.
 *
 * <p>No `href` is passed to a row. The whole card is already the drill target, and an anchor
 * inside an anchor is invalid markup that browsers resolve by dropping one of them.
 */
export function ExceptionList({
  id,
  title,
  drillTo,
  density,
  style,
  rows,
  emptyLabel,
}: PortletChromeProps & ExceptionListData) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
      /*
       * The rail states the WORST thing in the feed, and an empty feed is good news: a
       * warning-coloured rail over "Nothing needs you right now" is the card contradicting its
       * own contents.
       */
      accent={
        rows.length === 0
          ? "success"
          : rows.some((r) => r.severity === "danger")
            ? "danger"
            : "warning"
      }
      style={style}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)} data-testid={`portlet-${id}-clear`}>
          {emptyLabel}
        </p>
      ) : (
        <ActivityFeed label={title}>
          {rows.map((row) => (
            <ActivityRow
              key={row.key}
              tone={SEVERITY_TONE[row.severity]}
              toneLabel={SEVERITY_WORD[row.severity]}
              icon={row.icon ?? SEVERITY_ICON[row.severity]}
              timeLabel={row.timeLabel ?? ""}
              dateTime={row.dateTime}
            >
              <span className={cn("block font-medium text-foreground", T_BODY)}>{row.label}</span>
              <span className={cn("block text-foreground-tertiary", T_SMALL)}>{row.detail}</span>
            </ActivityRow>
          ))}
        </ActivityFeed>
      )}
    </PortletShell>
  );
}

export interface RecordRow {
  key: string;
  primary: string;
  secondary: string;
  trailing: React.ReactNode;
}

export interface RecordListData {
  rows: RecordRow[];
  emptyLabel: string;
  /**
   * Set when `primary` is a REFERENCE — an order number, an entry number, an invoice number.
   * The demo sets references in DM Mono (`#INV-2041`, `PO-1094`); a vendor name or a table name
   * is not a reference and is left in the text face.
   */
  monoPrimary?: boolean;
  accent?: PortletAccent;
}

/** The demo's "RECENT TRANSACTIONS": reference, context, amount, one hairline between rows. */
export function RecordList({
  id,
  title,
  drillTo,
  density,
  style,
  rows,
  emptyLabel,
  monoPrimary = false,
  accent = "primary",
}: PortletChromeProps & RecordListData) {
  return (
    <PortletShell
      id={id}
      title={title}
      drillTo={drillTo}
      drillLabel={`${title} — open the full list`}
      density={density}
      accent={accent}
      style={style}
    >
      {rows.length === 0 ? (
        <p className={cn("text-foreground-tertiary", T_SMALL)}>{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate font-medium",
                    monoPrimary ? "font-mono" : undefined,
                    T_BODY,
                  )}
                >
                  {row.primary}
                </span>
                <span className={cn("block text-foreground-tertiary", T_SMALL)}>
                  {row.secondary}
                </span>
              </span>
              <span className={cn("shrink-0 font-mono tabular-nums", T_H2)}>{row.trailing}</span>
            </li>
          ))}
        </ul>
      )}
    </PortletShell>
  );
}

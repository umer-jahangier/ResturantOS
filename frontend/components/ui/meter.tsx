"use client";

import * as React from "react";

import { useZone } from "@/components/providers/zone-provider";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatNumber } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * `Meter` — a proportion bar that **cannot be drawn without its denominator**.
 *
 * <h3>Why this exists at all</h3>
 *
 * The product has no progress primitive. `grep -rn 'role="progressbar"' components/ui
 * components/shared` returns **0**; the only bars in the codebase are drawn inline —
 * `portlet.tsx`'s `RankedList` (a `<div aria-hidden>` pair, deliberately hidden from AT because it
 * encodes nothing an AT user can act on) and `platform/usage-panel.tsx` (a `role="meter"` that
 * already got the honest parts right and is this component's direct ancestor). Twelve bars in the
 * calibration demo, one recipe, no shared implementation, and every one of them setting its width
 * and its colour from an inline style.
 *
 * <h3>The denominator is REQUIRED, and that is the whole point</h3>
 *
 * Three of the demo's five dashboard bars — `NEXUS_ERP_Demo.html:706,710,714` — state a
 * percentage and nothing else. A bar at 78 % of *nothing* is not a measurement; it is a rectangle
 * with a persuasive width. The real uses in this system all have a second number and are the
 * reason the primitive is worth having: occupancy `8 / 14`, shift coverage `11 / 14`, AP aging
 * against total payable, a cost ratio against its budget.
 *
 * So `of` is a required prop rather than an optional one, and there is no `fraction`/`percent`
 * escape hatch. **A decorative bar is not expressible through this component.** That is a
 * deliberate refusal of a shape the demo offers, not an oversight.
 *
 * <h3>An unknown value renders as an absence — never as 0 %, never as 100 %</h3>
 *
 * D-38-16: a number we cannot compute is rendered as an absence, never as a figure. Phase 38's own
 * audit found a bar that always read 100 % because it was fed a hardcoded `fraction: 1`, and the
 * three guards this codebase already carries against that defect class (`ReportCatalog.java:74-80`,
 * `ReportTable.tsx:22-34`, `owner-dashboard.tsx:52-65`) exist because it has been paid for before.
 *
 * Two mechanisms, because a convention is not a guard:
 *
 * 1. `value: null` is a **first-class state** and the type union forces `unavailableReason` with
 *    it. The track renders as an empty dashed outline — not a 0 %-filled track, which reads as
 *    "none used" — `aria-valuenow` is **omitted** (the ARIA-sanctioned way to say indeterminate)
 *    and the reason is shown and announced.
 * 2. A denominator that is absent, zero, negative or non-finite degrades to that same unknown
 *    state rather than dividing by zero into `Infinity` and clamping to a confident 100 %.
 *    It degrades rather than throws because `of` is frequently live data — a branch with no
 *    tables configured yet has a capacity of 0 — and crashing a dashboard is not honesty.
 *
 * A 100 % bar is therefore reachable only by passing a `value` that genuinely equals `of`.
 *
 * <h3>Over-limit is shown, not clipped away</h3>
 *
 * 32 against a budget of 30 fills the track completely — there is nowhere else for it to go — but
 * the readout still says `32 / 30`, `data-over="true"` is stamped for callers and tests, and
 * `aria-valuetext` carries the true pair. The bar is the second channel; the numbers are the
 * reading. For the same reason the fill is **not** floored at a visible minimum the way
 * `RankedList` floors it at 2 % — a sliver drawn for a value that is nearly zero is the same
 * category of lie in the other direction.
 *
 * <h3>Colour never travels alone (D-38-13)</h3>
 *
 * There is no free `tone` prop. Judgment is carried by `status`, whose `label` is **required**, so
 * a red bar without the word "Over budget" beside it cannot be constructed. The tones are the
 * closed semantic set — success / warning / danger / info. The `secondary` (teal) ramp is
 * deliberately absent: D-38-12 records it at ΔE2000 18.68 from `--success-600`, the closest pair in
 * the semantic set, and forbids it from carrying state meaning. The demo paints one of its five
 * bars teal; we do not.
 *
 * <h3>Zones (D-38-04) — `operational` by default, richness opt-in</h3>
 *
 * Safe on **all three zones**, including `operational` (POS, KDS), because the resting render has
 * no `backdrop-filter`, no entrance animation, no transform and no perpetual animation. The demo's
 * `transition: width 0.8s ease` — its slowest transition, 5.3× `--t-slow` — is available only
 * behind `animateFill`, and even then it is dropped in the `operational` zone, exactly as
 * `Skeleton` drops its shimmer there. Default off; the opt-in transition is a state transition on
 * `width` at `--motion-state` (120ms), inside phase 20's 240ms ceiling, and the global
 * `prefers-reduced-motion` net in `globals.css` collapses it without any JS involvement.
 *
 * <h3>Money</h3>
 *
 * `format="money"` renders both numerator and denominator through {@link MoneyDisplay}; values are
 * BIGINT paisa. This component never formats money itself — which is also why `aria-valuetext` is
 * omitted in that mode rather than built from a second formatter. The accessible text alternative
 * comes from `aria-describedby` pointing at the visible readout, so AT reads exactly the string on
 * screen, for every format.
 *
 * <h3>Not focusable, on purpose</h3>
 *
 * A progressbar takes no input, so it gets no `tabIndex` and no focus ring — a stop in the tab
 * order that does nothing is a defect, not an affordance. It is reachable in the AT reading order
 * with an accessible name (`aria-labelledby` → the visible label) and an accessible description.
 * A caller who wants the meter to drill through wraps it in a real `<a>`/`<button>`, which brings
 * that element's own `focus-visible` treatment with it.
 *
 * @example
 * <Meter label="Tables occupied" value={8} of={14} noun="tables" />
 * <Meter label="Food cost" value={28.4} of={30} format="percent" ofLabel="Budget"
 *        status={{ tone: "success", label: "Under budget" }} />
 * <Meter label="Gross margin" value={null} of={1} unavailableReason="COGS is not yet posted" />
 */

/** The closed set of judgment hues. `secondary` (teal) is excluded by D-38-12/D-38-13. */
export type MeterStatusTone = "success" | "warning" | "danger" | "info";

export interface MeterStatus {
  tone: MeterStatusTone;
  /**
   * The word. NOT optional — this is the second channel that keeps the hue from being the only
   * carrier of meaning (D-38-13). "Over budget", "At capacity", "Below target".
   */
  label: string;
}

/** How the two numbers are written out. Both sides always use the same one. */
export type MeterFormat = "count" | "percent" | "money";

interface MeterBaseProps {
  /** What is being measured. Becomes the visible label and the accessible name. */
  label: string;
  /**
   * The denominator — capacity, budget, target, total. **Required**: see the docblock. Anything
   * that is not a finite number greater than zero degrades the meter to its unknown state.
   * BIGINT paisa when `format="money"`.
   */
  of: number | bigint;
  /** Default `"count"`. */
  format?: MeterFormat;
  /** `format="count"` only: the thing being counted, e.g. `"tables"`. Appended to the readout. */
  noun?: string;
  /** `format="money"` only. Passed straight to {@link MoneyDisplay}. */
  currency?: string;
  /**
   * Names the denominator underneath the bar — `ofLabel="Budget"` renders "Budget: 30%", which is
   * the demo's own caption. Omit it when `label` already says what the denominator is.
   */
  ofLabel?: string;
  /** Judgment. Hue plus a required word. */
  status?: MeterStatus;
  /** `"sm"` = the demo's 5px hairline (default). `"md"` = its 8px ratio bar. */
  size?: "sm" | "md";
  /**
   * Opt in to the demo's filling transition. Ignored in the `operational` zone (D-38-04) and
   * collapsed under `prefers-reduced-motion` by the stylesheet. Default `false`.
   */
  animateFill?: boolean;
  /**
   * Visually hide the label when the surrounding row already states it (a ranked list, a
   * definition row). The label is still rendered, still required, and still the accessible name —
   * this hides it, it does not remove it.
   */
  labelHidden?: boolean;
  className?: string;
}

/**
 * The union is the guard: `value: null` cannot be written without saying why, and a known value
 * cannot smuggle an unavailability reason in beside it.
 */
export type MeterProps = MeterBaseProps &
  (
    | { value: number | bigint; unavailableReason?: never }
    | { value: null; unavailableReason: string }
  );

const TRACK_HEIGHT: Record<NonNullable<MeterBaseProps["size"]>, string> = {
  sm: "h-1.5",
  md: "h-2",
};

const FILL_TONE: Record<MeterStatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

const TEXT_TONE: Record<MeterStatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

/** The one reason string this component supplies for itself. */
const NO_DENOMINATOR = "No denominator to measure against";

/**
 * Locale PINNED, not left to the runtime (D-38-20).
 *
 * `new Intl.NumberFormat(undefined, …)` resolves differently on the server and in the browser:
 * Next prerenders this `"use client"` component with the server's ICU default, then hydrates
 * against `navigator.language`. For any value >= 1000 or carrying a fraction the group and
 * decimal separators differ — measured, `de-DE` gives `1.234,5` where `en-US` gives `1,234.5` —
 * which is a hydration text mismatch on precisely the numbers a meter exists to display.
 *
 * This file used to restate that choice as its own `"en-PK"` literal, on the argument that a
 * reader of this file should be able to see it. That argument lost: a restated constant is a
 * constant that can be edited in one place and not the other, and the eleven call sites added
 * after this fix restated nothing at all. The choice now arrives from `lib/format/locale.ts`,
 * which is the single literal, and `__tests__/lib/theme/locale-pinning.test.ts` fails any file
 * that goes back to deciding for itself.
 */
const formatMeterNumber = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

/** `null` for anything that cannot honestly become a finite number — `NaN` and `Infinity` included. */
function finite(input: number | bigint | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function Meter({
  label,
  value,
  of,
  unavailableReason,
  format = "count",
  noun,
  currency,
  ofLabel,
  status,
  size = "sm",
  animateFill = false,
  labelHidden = false,
  className,
}: MeterProps) {
  const zone = useZone();
  const reactId = React.useId();
  const labelId = `meter-label-${reactId}`;
  const readoutId = `meter-readout-${reactId}`;

  const numerator = finite(value);
  const rawDenominator = finite(of);

  // A denominator that cannot divide is the SAME state as a missing value, not a special case —
  // which is what stops `x / 0` from clamping into a confident full bar.
  const denominator = rawDenominator !== null && rawDenominator > 0 ? rawDenominator : null;
  const known = numerator !== null && denominator !== null;
  const reason = known ? null : (unavailableReason ?? NO_DENOMINATOR);

  const over = numerator !== null && denominator !== null && numerator > denominator;
  // Clamped for the FILL only. The readout below is never clamped.
  const fillPercent =
    numerator !== null && denominator !== null
      ? Math.min(100, Math.max(0, Math.round((numerator / denominator) * 10000) / 100))
      : 0;

  const writeNumber = (n: number | bigint) =>
    format === "money" ? (
      <MoneyDisplay paisa={n} currency={currency} />
    ) : format === "percent" ? (
      `${formatMeterNumber(Number(n))}%`
    ) : (
      formatMeterNumber(Number(n))
    );

  // Built as a plain string only where no money is involved — this component must never own a
  // second money formatter, not even for an ARIA attribute.
  const valueText =
    numerator === null || denominator === null || format === "money"
      ? undefined
      : `${formatMeterNumber(numerator)} of ${formatMeterNumber(denominator)}` +
        (noun && format === "count" ? ` ${noun}` : format === "percent" ? " percent" : "") +
        (over ? " — over" : "");

  const animate = animateFill && zone !== "operational";

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)} data-slot="meter">
      <div className="flex items-baseline justify-between gap-2 text-small">
        <span id={labelId} className={cn("truncate", labelHidden ? "sr-only" : "text-foreground-secondary")}>
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {status ? (
            <span className={cn("text-label font-medium", TEXT_TONE[status.tone])}>
              {status.label}
            </span>
          ) : null}
          <span id={readoutId} className="font-medium tabular-nums">
            {known ? (
              <>
                {writeNumber(value as number | bigint)}
                <span aria-hidden="true"> / </span>
                <span className="sr-only"> of </span>
                {writeNumber(of)}
                {noun && format === "count" ? ` ${noun}` : null}
              </>
            ) : (
              // An em dash, which is this codebase's established rendering for a figure that has
              // no honest source (owner-dashboard.tsx:52-65). Never "0" and never "100%".
              <span className="text-foreground-tertiary">{"—"}</span>
            )}
          </span>
        </span>
      </div>

      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-describedby={readoutId}
        aria-valuemin={0}
        aria-valuemax={denominator ?? undefined}
        // OMITTED when unknown — the ARIA-sanctioned way to express an indeterminate meter. A
        // `0` here would be a claim.
        aria-valuenow={
          numerator !== null && denominator !== null
            ? Math.max(0, Math.min(numerator, denominator))
            : undefined
        }
        aria-valuetext={(known ? valueText : reason) ?? undefined}
        data-slot="meter-track"
        data-unknown={known ? undefined : "true"}
        data-over={over ? "true" : undefined}
        className={cn(
          "w-full overflow-hidden rounded-full",
          TRACK_HEIGHT[size],
          known ? "bg-muted" : "border border-dashed border-border",
        )}
      >
        {known ? (
          <div
            data-slot="meter-fill"
            className={cn(
              "h-full rounded-full",
              status ? FILL_TONE[status.tone] : "bg-primary-solid",
              animate && "transition-[width] duration-(--motion-state) ease-(--motion-ease)",
            )}
            style={{ width: `${fillPercent}%` }}
          />
        ) : null}
      </div>

      {reason ? (
        <p data-slot="meter-caption" className="text-label text-foreground-tertiary">
          {reason}
        </p>
      ) : ofLabel ? (
        <p data-slot="meter-caption" className="text-label text-foreground-tertiary">
          <span>{ofLabel}: </span>
          {writeNumber(of)}
        </p>
      ) : null}
    </div>
  );
}

export { Meter };

"use client";

import * as React from "react";
import { AlertTriangle, CircleAlert, XCircle } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * The two things `/app/inventory/stock` has to say honestly, in one place (plan 38-07 tasks 3
 * and 4).
 *
 * <h3>Why these two live together</h3>
 *
 * They are the same defect seen twice. A stock screen's job is to tell an owner what is on the
 * shelf; both an alert and a negative number are the screen saying *"this row is not what it
 * appears"*, and both were previously rendered as if they were ordinary. Keeping them in one
 * module means the alert wording and the negative-quantity wording cannot drift apart, and it
 * gives both a unit test that does not have to mount a page.
 *
 * <h3>Task 3 — an alert is three channels, never one (UI-SPEC §4.2)</h3>
 *
 * Colour alone fails for the ~8 % of men with a red/green deficiency, fails in a print-out, and
 * fails on a washed-out kitchen screen in daylight. So every alert carries an <b>icon</b>, a
 * <b>word</b> and a <b>hue</b>. `StatusBadge`'s legacy `warning`/`error` variants render
 * label-only, so the icon is composed alongside rather than forking `status-badge.tsx`, which
 * this plan does not own.
 *
 * <h3>Task 4 — a negative quantity is a claim about reality that is false</h3>
 *
 * Measured live, this product renders <b>Chicken −2987 KG</b> and <b>Total stock value:
 * −Rs 2,116,690.70</b> as ordinary numbers in ordinary type. No shelf holds minus two thousand
 * kilograms of chicken. The figure is not wrong in the arithmetic sense — it is the faithful sum
 * of the movements the system was told about — it is *unrealisable*, and a screen that prints it
 * in the same weight as a real quantity has quietly asserted that it is one.
 *
 * <p>This follows the standard `/app/finance/takings` set: <i>"it will not show you a zero it
 * does not mean."</i> The number is still shown — hiding it would be a second lie, and inventory
 * correctness is explicitly out of this plan's scope — but it is shown as a flagged figure with
 * the reason one keystroke away.
 */

/** Reads a quantity that may arrive as the API's string form. Non-numeric input is not negative. */
export function isNegativeQuantity(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n < 0;
}

/**
 * Why an on-hand quantity can be below zero, in the words of the person who has to fix it.
 *
 * <p>Deliberately not "an error occurred": nothing failed. The sequence is mundane and the user
 * needs to recognise it — stock left the building through a sale or an issue before the paperwork
 * that brought it in was ever entered.
 */
export const NEGATIVE_ON_HAND_REASON =
  "More has been sold or issued than was ever received in the system. Nothing failed — the receipts behind this stock were not recorded, so the running total went below zero. A stock count sets it back to what is physically on the shelf.";

/** The same statement for a valuation, which is the negative quantities multiplied by cost. */
export const NEGATIVE_VALUE_REASON =
  "This total includes items whose on-hand quantity is below zero, so it values stock that is not on any shelf. It is not a loss and it is not a write-down. Counting the flagged items corrects both the quantity and this figure.";

/**
 * The "Why?" affordance.
 *
 * <p>A word, not a bare glyph: `?` beside a number is ambiguous — it reads as "is this
 * uncertain?" rather than "here is the reason". And it is a real button rather than a tooltip so
 * that touch and keyboard users get it at all.
 *
 * <p>The 44px target is carried by `h-11` with a negative block margin, so the control meets
 * UI-SPEC §11 without forcing a 44px row on a 32px-density grid — the same technique
 * `DataGrid`'s sortable header uses.
 */
export function WhyButton({
  label,
  children,
  className,
}: {
  /** Names the figure this explains, e.g. `"Chicken on hand"`. Becomes the accessible name. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="why-button"
          aria-label={`Why is ${label} below zero?`}
          className={cn(
            "-my-2.5 inline-flex h-11 items-center gap-1 rounded-md px-1 text-small font-medium",
            "text-destructive underline underline-offset-2 hover:text-destructive/80",
            className,
          )}
        >
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          Why?
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3 text-small leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * An on-hand quantity, flagged when it is below zero.
 *
 * <p>Three channels again, because the flag is an alert: the word "below zero", the
 * `CircleAlert` glyph inside the affordance, and `text-destructive`. Strip the colour and the
 * sentence still says it.
 */
export function OnHandQuantity({
  qty,
  uom,
  name,
}: {
  qty: string | number;
  uom: string;
  /** The row's subject, used to name the affordance: "Why is Chicken on hand below zero?" */
  name: string;
}) {
  const negative = isNegativeQuantity(qty);
  const text = `${qty} ${uom}`;

  if (!negative) return <span className="tabular-nums">{text}</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums font-medium text-destructive" data-testid="negative-on-hand">
        {text}
      </span>
      <span className="text-small text-destructive">below zero</span>
      <WhyButton label={`${name} on hand`}>{NEGATIVE_ON_HAND_REASON}</WhyButton>
    </span>
  );
}

/**
 * Wraps any money figure that may be negative — the stock-value column and the branch total.
 *
 * <p>The amount itself is NOT re-formatted here. It arrives as a rendered `MoneyDisplay`, which
 * remains the product's single money path (BIGINT paisa, one formatter shared with the JVM). This
 * component only adds the flag beside it; a second formatter would be exactly the divergence the
 * money rule exists to prevent.
 */
export function FlaggedValue({
  paisa,
  label,
  reason = NEGATIVE_VALUE_REASON,
  children,
}: {
  paisa: number | bigint;
  label: string;
  reason?: string;
  children: React.ReactNode;
}) {
  const negative = typeof paisa === "bigint" ? paisa < 0n : paisa < 0;
  if (!negative) return <>{children}</>;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-destructive" data-testid="negative-value">
        {children}
      </span>
      <WhyButton label={label}>{reason}</WhyButton>
    </span>
  );
}

/** What a stock row's flags mean, resolved once so the chip and the row wash cannot disagree. */
export type StockAlertLevel = "out" | "low" | "ok";

/**
 * Reads the server-decided flags only.
 *
 * <p>`qtyOnHand` is never compared against `reorderPoint` in the browser (T-08.2-173): this
 * phase's own origin bug was exactly that class of frontend/backend divergence. Out-of-stock wins
 * over low, because a row cannot be usefully both and the more severe statement is the one an
 * owner has to act on.
 */
export function stockAlertLevel(row: {
  belowReorderPoint: boolean;
  nonPositive: boolean;
}): StockAlertLevel {
  if (row.nonPositive) return "out";
  if (row.belowReorderPoint) return "low";
  return "ok";
}

/** Icon + word + hue. Never fewer than three. */
export function StockAlertChip({ level }: { level: StockAlertLevel }) {
  if (level === "out") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive" data-testid="stock-alert-out">
        <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
        <StatusBadge status="error" label="Out of stock" />
      </span>
    );
  }
  if (level === "low") {
    return (
      <span className="inline-flex items-center gap-1 text-warning" data-testid="stock-alert-low">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <StatusBadge status="warning" label="Below reorder point" />
      </span>
    );
  }
  // "In stock" and not an em-dash: a blank cell in a Status column reads as "not yet assessed".
  return (
    <span className="text-small text-muted-foreground" data-testid="stock-alert-ok">
      In stock
    </span>
  );
}

/** The row wash. Destructive wins when both flags are set, mirroring `CustomerAccountRow`. */
export function stockRowClassName(row: {
  belowReorderPoint: boolean;
  nonPositive: boolean;
}): string | undefined {
  const level = stockAlertLevel(row);
  if (level === "out") return "bg-destructive/10";
  if (level === "low") return "bg-warning/10";
  return undefined;
}

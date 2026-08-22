import * as React from "react";
import { formatPaisa } from "@/lib/adapters/shared";
import { cn } from "@/lib/utils";

/**
 * How the amount is written down. One formatter, two conventions.
 *
 * <p>`plain` is the product's default and the one the JVM cross-check pins: a negative takes a
 * leading minus ahead of the prefix (`-Rs 500.00`, vector "negative takes a leading sign").
 *
 * <p>`accounting` is the LEDGER convention and is opt-in per call site: a negative is written in
 * parentheses (`(Rs 500.00)`). The demo's P&L writes deductions this way (`:1097`,
 * `($19,432)`), and the reason it survives here is not aesthetics — a minus glyph is one or two
 * pixels wide and is the first thing lost to a low-contrast render, a photocopy or a
 * screenshot pasted into a chat. Parentheses are a SHAPE, so the sign still reads in greyscale
 * and to a reader who cannot separate the red from the black (D-38-13: never colour alone).
 *
 * <p>`signed` is the REGISTER convention: an explicit `+` on a credit, a `−` on a debit, because
 * on a transaction line the direction of the money IS the fact. Same reasoning — the sign is a
 * character, not a hue.
 */
export type MoneySign = "plain" | "accounting" | "signed";

interface MoneyDisplayProps {
  paisa: number | bigint;
  currency?: string;
  className?: string;
  /**
   * Extra decimal places, for a RATE rather than an amount. A per-gram cost of 6.2 paisa is
   * Rs 0.062 — it reads as Rs 0.06 at the usual two places, and anything cheaper reads as Rs 0.00,
   * which is exactly the "this is free" impression a unit cost must never give. Pass 4 on a
   * per-unit cost column; leave it alone for money.
   */
  maxFractionDigits?: number;
  /**
   * Default `plain` — the exact string {@link formatPaisa} produces, which is what the shared
   * JVM vectors assert. Anything else is a presentation of the SAME formatted number, never a
   * second formatting path: the digits, grouping, currency prefix and decimal places are still
   * produced by `formatPaisa` and nothing here divides, rounds or pads.
   */
  sign?: MoneySign;
}

/**
 * Renders a paisa amount. The conversion itself lives in {@link formatPaisa} — one site shared
 * with `toMoney` and pinned against the JVM formatter by a vector file both stacks read
 * (37-01). This component owns the markup and nothing about the number.
 *
 * <p>THE only money path in the product (38-08 task 2). Not a tooltip, not a CSV column, not a
 * print template may re-derive a rupee figure: a second `toFixed(2)` is how a screen and a
 * printed bill come to disagree by a paisa, and a paisa is enough to make an owner distrust
 * both.
 *
 * <h3>The parentheses are announced, not only drawn</h3>
 *
 * `(Rs 500.00)` read aloud is "Rs 500.00" — a screen reader does not voice brackets. So the
 * accounting and signed faces carry an `aria-label` that says the word "negative", and the
 * visible glyphs are marked `aria-hidden`. Without that, the one convention chosen because it
 * survives a lossy channel would be lost entirely on the most lossy channel of all.
 */
function MoneyDisplay({
  paisa,
  currency = "PKR",
  className,
  maxFractionDigits = 2,
  sign = "plain",
}: MoneyDisplayProps) {
  const negative = typeof paisa === "bigint" ? paisa < 0n : paisa < 0;
  const positive = typeof paisa === "bigint" ? paisa > 0n : paisa > 0;
  const classes = cn("tabular-nums font-medium", className);

  // ── `accounting` — the ONE face that re-derives the string ───────────────────────────────────
  //
  // The parentheses REPLACE the minus, so the magnitude has to be formatted rather than the
  // signed value. `-paisa` under the union needs the typeof to narrow first: BigInt negation and
  // number negation are different operators to the compiler even though they read the same.
  if (sign === "accounting" && negative) {
    const magnitude: number | bigint = typeof paisa === "bigint" ? -paisa : Math.abs(paisa);
    const formatted = formatPaisa(magnitude, { maxFractionDigits, currency });
    return (
      <span className={classes} aria-label={`negative ${formatted}`} data-negative="true">
        <span aria-hidden="true">({formatted})</span>
      </span>
    );
  }

  // ── Every other face prints EXACTLY what `formatPaisa` returned ──────────────────────────────
  //
  // Including the negative under `signed`. An earlier draft used U+2212 MINUS there, on the
  // reasoning that it is digit-width and keeps a column aligned. It also made the negative string
  // differ by one codepoint from the same amount rendered anywhere else in the product — a second
  // spelling of a number, which is the defect this whole component exists to prevent, arrived at
  // through typography rather than through arithmetic. `formatPaisa`'s own sign wins; `signed`
  // adds only the `+` that the formatter does not emit.
  const formatted = formatPaisa(paisa, { maxFractionDigits, currency });

  if (sign === "signed" && (negative || positive)) {
    return (
      <span
        className={classes}
        aria-label={`${negative ? "negative" : "positive"} ${formatted.replace("-", "")}`}
        data-negative={negative ? "true" : undefined}
      >
        <span aria-hidden="true">
          {positive ? "+" : ""}
          {formatted}
        </span>
      </span>
    );
  }

  // `plain`, a non-negative `accounting` amount, and a `signed` ZERO — which takes no sign,
  // because zero has no direction and `+Rs 0.00` claims one.
  return <span className={classes}>{formatted}</span>;
}

export { MoneyDisplay };

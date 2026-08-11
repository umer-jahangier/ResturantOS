"use client";

import { formatPaisa } from "@/lib/adapters/shared";
import { isKnown, type MoneyFigure } from "@/lib/models/takings.model";
import { cn } from "@/lib/utils";

/**
 * THE element for a figure the server could not compute (D-37-05, T-32-12-A).
 *
 * <h3>Why this is a component and not a `?? 0`</h3>
 *
 * A zero on a takings screen is a claim: "the drawer matched", "nothing was given away today",
 * "no cash is missing". Someone acts on it. When the system does not know, the honest render is
 * the REASON, in the place the number would have been — never a zero, never a blank, and never a
 * dash that looks like every other dash on the screen.
 *
 * The precedent is the SuperAdmin usage panel, which draws no progress track at all for an
 * unmetered resource rather than a zero-percent one: "an empty track reads as 'nothing used'; the
 * absence of a track reads as 'no measurement', which is the true statement." This reuses that
 * treatment — muted, italic, a short headline plus the server's own sentence — rather than
 * inventing a second visual language for the same idea. Two ways of saying "we do not know" is
 * one too many.
 *
 * <h3>The accessible label</h3>
 *
 * A screen reader must hear an ABSENCE, not a value. The visible text is short so the layout
 * holds; `aria-label` carries the whole sentence, so the reason is available to a reader who
 * cannot see the tooltip.
 */
export function UnknownFigure({
  figure,
  className,
  compact,
}: {
  figure: Extract<MoneyFigure, { state: "UNKNOWN" }>;
  className?: string;
  /** Inside a table cell: headline only, reason via label and title. */
  compact?: boolean;
}) {
  const headline = "Not known";
  return (
    <span
      data-testid="unknown-figure"
      data-figure-key={figure.figureKey}
      role="note"
      aria-label={`${figure.figureKey}: not known. ${figure.reason}`}
      title={figure.reason}
      className={cn(
        // Deliberately NOT tabular-nums and NOT the money weight — it must not scan as a number.
        "inline-flex flex-col gap-0.5 text-muted-foreground",
        className,
      )}
    >
      <span className="text-sm font-medium italic">{headline}</span>
      {!compact && (
        // Clamped, not truncated away: the first two lines carry the point ("comps are not recorded
        // separately"), and the whole sentence stays reachable through the tooltip and the
        // accessible label. A reason that pushes every other figure off the fold is a reason nobody
        // reads — but a reason only available on hover would fail a screen reader, hence both.
        <span className="line-clamp-2 max-w-prose text-xs font-normal not-italic leading-snug">
          {figure.reason}
        </span>
      )}
    </span>
  );
}

/**
 * Render a figure in whichever of its two states it is in.
 *
 * Every amount on this screen goes through `formatPaisa` — the one place a paisa integer becomes a
 * string a person reads (37-01). It is byte-identical to the JVM's `ReceiptMoneyFormatter`, so the
 * screen, the printed bill and the ledger agree to the paisa. There is no second formatting path
 * here and there must not be one.
 *
 * A genuinely zero figure renders as `Rs 0.00` in the money treatment — visually nothing like the
 * unknown element, which is the entire point.
 */
export function FigureValue({
  figure,
  className,
  compact,
  signed,
}: {
  figure: MoneyFigure;
  className?: string;
  compact?: boolean;
  /** Show an explicit `+` on a positive amount. For variances, where the sign IS the message. */
  signed?: boolean;
}) {
  if (!isKnown(figure)) {
    return <UnknownFigure figure={figure} className={className} compact={compact} />;
  }
  const prefix = signed && figure.paisa > 0 ? "+" : "";
  return (
    <span
      data-testid="known-figure"
      className={cn("tabular-nums", className)}
    >
      {prefix}
      {formatPaisa(figure.paisa)}
    </span>
  );
}

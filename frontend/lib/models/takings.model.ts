// Layer-1 domain model for the evening cash-up (37-09 API / 37-12 screen, D-37-02 + D-37-05).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THERE IS NO `amountOrZero`, AND THERE MUST NEVER BE ONE.
//
// Every figure on this screen is a two-case union: the server either stated an amount or stated
// why it could not. A convenience accessor that returns 0 for the not-computed case would be used
// — it always is — and the day it is, this screen starts telling a restaurant owner that the
// drawer matched when in truth nobody counted it. A zero on a takings screen is a claim, not a
// placeholder. `UNKNOWN` carries no `paisa` field at all, so there is no property to read: the
// mistake is unrepresentable rather than merely discouraged.
//
// The same rule governs the till states below. `OPEN` (the shift has not ended) and `NOT_COUNTED`
// (the shift ended and nobody counted the drawer) are DIFFERENT FACTS. One is a normal evening in
// progress; the other is a control failure. They must never render as the same dash.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A money figure, in the only two states the server can be in about it.
 *
 * `UNKNOWN` deliberately has no `paisa`. Do not add one, and do not widen this union to a third
 * case that carries both.
 */
export type MoneyFigure =
  | { readonly state: "KNOWN"; readonly paisa: number }
  | {
      readonly state: "UNKNOWN";
      /** The server's own name for the figure, e.g. `"cash variance"`. Never invented here. */
      readonly figureKey: string;
      /** The server's own sentence. Rendered verbatim so it cannot drift from the API. */
      readonly reason: string;
    };

/** Narrowing helper. Exists so components read `isKnown(f)` rather than touching `.state` ad hoc. */
export function isKnown(
  figure: MoneyFigure,
): figure is { readonly state: "KNOWN"; readonly paisa: number } {
  return figure.state === "KNOWN";
}

/**
 * The five named states 37-09's `DailyTakingsService` emits. Never inferred from a null variance —
 * that inference is exactly what collapses OPEN and NOT_COUNTED into one meaningless dash.
 */
export type TillReconciliationState =
  | "OPEN"
  | "MATCHED"
  | "OVER"
  | "SHORT"
  | "NOT_COUNTED";

export interface TenderLine {
  /** CASH, CARD, WALLET … as the server observed it. A method with no rows is ABSENT, not zero. */
  method: string;
  amountPaisa: number;
  paymentCount: number;
}

export interface TillReconciliation {
  tillSessionId: string;
  cashierId: string | null;
  status: string;
  openingFloatPaisa: number;
  /** Opening float + cash taken − cash refunded, as the system computes it. */
  expectedClosing: MoneyFigure;
  /** What a human counted in the drawer. */
  declaredClosing: MoneyFigure;
  /** declared − expected. NEGATIVE means the drawer is SHORT. The server's sign, unflipped. */
  variance: MoneyFigure;
  openedAt: Date;
  closedAt: Date | null;
  reconciliationState: TillReconciliationState;
}

/** A figure the server named but could not compute, kept raw for anything not mapped below. */
export interface UnknownFigure {
  figure: string;
  reason: string;
}

export interface DailyTakings {
  /** ISO business date, e.g. `2026-08-06`. The trading day is `(closed_at − 4h)` UTC (37-03). */
  businessDate: string;
  branchId: string | null;

  /** Full menu price of everything sold, BEFORE any discount — gross, not gross-less-discount. */
  gross: MoneyFigure;
  discounts: MoneyFigure;
  comps: MoneyFigure;
  tax: MoneyFigure;
  serviceCharge: MoneyFigure;
  /** What the bills came to. Stated by the server; NEVER re-derived here (T-32-12-E). */
  net: MoneyFigure;
  orderCount: number;

  byTender: TenderLine[];
  tills: TillReconciliation[];

  /**
   * A DAY-level statement that the cash variance is not computable at all — cash was taken and no
   * till was closed and counted. `null` when the server made no such statement, which is not the
   * same as "the variance is zero"; the per-till figures are authoritative in that case.
   */
  dayCashVariance: Extract<MoneyFigure, { state: "UNKNOWN" }> | null;

  /**
   * Unknowns the server named that this model does not have a field for. Rendered as-is rather
   * than dropped: a reason code shipped by a newer server must degrade to something honest, and
   * silently swallowing it is how a screen quietly stops mentioning a figure it cannot compute.
   */
  residualUnknowns: UnknownFigure[];
}

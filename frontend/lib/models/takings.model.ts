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
export type TillReconciliationState = "OPEN" | "MATCHED" | "OVER" | "SHORT" | "NOT_COUNTED";

export interface TenderLine {
  /** CASH, CARD, WALLET … as the server observed it. A method with no rows is ABSENT, not zero. */
  method: string;
  /**
   * What settled the BILL on this method today, dated by when it was TAKEN — open orders included.
   *
   * Tips are NOT in this number; they are `tipPaisa` beside it. A tip never touches the balance and
   * is not revenue, so folding it in here would stop the split reconciling against `totalBilled`.
   */
  amountPaisa: number;
  /**
   * Taken on this tender ON TOP of the bill (F20). **An ADDITION to `amountPaisa`, not a subset** —
   * the exact opposite of `unclosedAmountPaisa` below, which is why both rules are written down.
   *
   * Per tender rather than one day total, because a tip's tender is the whole fact about it: the
   * cash ones are in a drawer somebody counts tonight and the card ones are with the acquirer. This
   * is the figure that makes a till's EXPECTED CASH explainable — `TillServiceImpl.closeTill`
   * counts `amount + tip` into it, and while the server sent only `amount` the two diverged by
   * exactly the day's cash tips with nothing on the page naming the difference.
   */
  tipPaisa: number;
  paymentCount: number;
  /**
   * The part of `amountPaisa` sitting against an order that is not closed yet.
   *
   * A SUBSET, never an addition. Rendering it as a second row invites the reader to add the two,
   * and the sum would be twice the money that exists.
   */
  unclosedAmountPaisa: number;
  unclosedPaymentCount: number;
}

/**
 * Money taken today that has not become a closed sale yet — why the drawer can legitimately hold
 * more than the day's net sales.
 *
 * These are plain numbers rather than `MoneyFigure`s on purpose: the server always computes them
 * (they are a `SUM … FILTER` over rows it already has), so there is no "could not work it out"
 * case to represent and a union would invent a state that cannot occur.
 */
export interface UnclosedTakings {
  cashPaisa: number;
  /**
   * Cash tips on those same still-open orders. In the drawer, and ADDED to `cashPaisa`.
   *
   * This panel is what tells a counter to "expect the count to include it". Saying that of the
   * amounts alone leaves the sentence short by the tips and sends them hunting an overage that is
   * the restaurant's own gratuity.
   */
  cashTipPaisa: number;
  totalPaisa: number;
  /** Tips across every tender. Only `cashTipPaisa` is in a drawer; this is stated so card tips
   * on open bills are not silently dropped. */
  tipPaisa: number;
  /** How many distinct orders those payments sit against. */
  orderCount: number;
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

  /**
   * Full menu price of everything sold, BEFORE any discount — gross, not gross-less-discount.
   *
   * Dated by when each bill was FINALISED, which is not the same instant the money arrived. See
   * `unclosed` — the screen must say so rather than let a reader assume one basis for both.
   */
  gross: MoneyFigure;
  discounts: MoneyFigure;
  comps: MoneyFigure;

  /**
   * NET SALES — `gross − discounts`, with tax and service charge OUTSIDE it. The revenue line.
   *
   * This field used to carry the BILL TOTAL, because the server sent the bill total under the name
   * `netSalesPaisa`. The screen therefore showed NET SALES Rs 45,966.40 above GROSS SALES
   * Rs 43,350.00 — a "net" figure larger than the gross it came out of, because output tax had
   * been added into it. Tax is money owed to the tax authority; it is not revenue and it is not
   * inside net. The bill total now has its own field, `totalBilled`, and its own tile.
   *
   * Stated by the server; NEVER re-derived here (T-32-12-E).
   */
  net: MoneyFigure;
  tax: MoneyFigure;
  serviceCharge: MoneyFigure;
  /**
   * TOTAL BILLED — `net + tax + service charge`, i.e. what the bills actually came to.
   *
   * This is the figure that reconciles against the tender split below. Stated by the server, like
   * everything else here: the screen does not add three tiles together to make a fourth.
   */
  totalBilled: MoneyFigure;
  /** Orders CLOSED on this trading day — NOT the number of orders that took money. */
  orderCount: number;

  /** How the money arrived, dated by when it arrived rather than by when its order closed. */
  byTender: TenderLine[];
  tills: TillReconciliation[];

  /**
   * The bridge between the two bases above: money already taken today that is still sitting
   * against orders which have not closed.
   *
   * This is the figure whose absence was DEFECT S0-02 — cash rung against an unserved order
   * reached the drawer, the till's expected closing counted it, and this screen showed nothing at
   * all: not in gross, not in net, not on the CASH line.
   */
  unclosed: UnclosedTakings;

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

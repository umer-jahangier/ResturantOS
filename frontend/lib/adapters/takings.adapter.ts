import type {
  DailyTakings,
  MoneyFigure,
  TenderLine,
  TillReconciliation,
  TillReconciliationState,
  UnclosedTakings,
  UnknownFigure,
} from "@/lib/models/takings.model";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Layer-2b adapter: wire shape -> domain model (37-12).
//
// THIS ADAPTER DOES NO ARITHMETIC ON FIGURES. It maps states and carries integer paisa through
// untouched. Net is not derived from gross; a variance is not derived from expected and declared.
// The server owns every one of those identities and a second implementation is a second thing to
// drift — see T-32-12-E.
//
// ── The shape the plan expected, and the shape the API actually has ──────────────────────────
// 37-12's plan assumed the server returns each figure as a two-state union. It does not. The live
// response (verified against the running stack, not read from the plan) is:
//
//     { grossSalesPaisa: 3339000, ..., unknowns: [ { figure: "comps", reason: "…" } ] }
//
// — bare numbers, plus a side list of figures the server declined to state, keyed by NAME. So the
// union is assembled HERE, by joining `unknowns` onto the named fields. A figure named in
// `unknowns` becomes UNKNOWN and its number never reaches the model; everything else is KNOWN.
// This is the join that keeps the screen honest, and it is the only place it exists.

/** Server figure name -> the model field it governs. The server's spelling, verbatim. */
const FIGURE_KEY_TO_FIELD: Record<string, keyof DailyTakings | "dayCashVariance"> = {
  comps: "comps",
  "cash variance": "dayCashVariance",
  gross: "gross",
  "gross sales": "gross",
  discounts: "discounts",
  tax: "tax",
  "service charge": "serviceCharge",
  net: "net",
  "net sales": "net",
  "total billed": "totalBilled",
};

function unknown(figureKey: string, reason: string): Extract<MoneyFigure, { state: "UNKNOWN" }> {
  return { state: "UNKNOWN", figureKey, reason };
}

/**
 * The sentence for a till figure the server left null, chosen by the server's OWN named state.
 *
 * This is the distinction the whole panel turns on: a till that is still open has not been cashed
 * up yet, and a till that was closed without a count is a control failure. Rendering both as a
 * dash makes them the same fact, and they are not.
 */
function tillAbsenceReason(state: string, figure: string): string {
  switch (state) {
    case "OPEN":
      return `This till is still open — the shift has not been cashed up, so ${figure} does not exist yet.`;
    case "NOT_COUNTED":
      return `This till was closed without anyone counting the drawer, so there is no ${figure} to report. This is NOT a zero.`;
    default:
      // A state this build does not recognise degrades to something honest that names it, rather
      // than to a blank or — far worse — to a zero.
      return `The server reported this till as "${state}" and stated no ${figure}.`;
  }
}

function tillFigure(raw: number | null | undefined, state: string, label: string): MoneyFigure {
  if (raw === null || raw === undefined) {
    return unknown(label, tillAbsenceReason(state, label));
  }
  return { state: "KNOWN", paisa: Number(raw) };
}

const KNOWN_STATES: readonly string[] = ["OPEN", "MATCHED", "OVER", "SHORT", "NOT_COUNTED"];

export function adaptTillReconciliation(raw: any): TillReconciliation {
  const state = String(raw.reconciliationState ?? "");
  return {
    tillSessionId: raw.tillSessionId,
    cashierId: raw.cashierId ?? null,
    status: raw.status,
    openingFloatPaisa: Number(raw.openingFloatPaisa ?? 0),
    expectedClosing: tillFigure(raw.expectedClosingPaisa, state, "expected cash"),
    declaredClosing: tillFigure(raw.declaredClosingPaisa, state, "counted cash"),
    variance: tillFigure(raw.variancePaisa, state, "variance"),
    openedAt: new Date(raw.openedAt),
    closedAt: raw.closedAt ? new Date(raw.closedAt) : null,
    // Preserved as the server sent it. An unrecognised state is passed through rather than
    // coerced onto a known one; the renderer degrades it, the adapter does not hide it.
    reconciliationState: (KNOWN_STATES.includes(state) ? state : state) as TillReconciliationState,
  };
}

export function adaptTenderLine(raw: any): TenderLine {
  return {
    method: raw.method,
    amountPaisa: Number(raw.amountPaisa ?? 0),
    // A server too old to send this omits it. 0 is the only honest reading of "this build does not
    // report tips" — and it is NOT the same kind of zero as the subset below. A missing tip figure
    // UNDERSTATES the drawer, so the screen must go on saying which figure the drawer expectation
    // is built from rather than quietly presenting a number that no longer includes it.
    tipPaisa: Number(raw.tipPaisa ?? 0),
    paymentCount: Number(raw.paymentCount ?? 0),
    // A server too old to send these omits them, and 0 is the only honest reading of "this build
    // does not report an unclosed portion" — it is a SUBSET of a number that is already stated,
    // not a figure of its own, so a zero here understates nothing and invents nothing.
    unclosedAmountPaisa: Number(raw.unclosedAmountPaisa ?? 0),
    unclosedPaymentCount: Number(raw.unclosedPaymentCount ?? 0),
  };
}

export function adaptUnclosedTakings(raw: any): UnclosedTakings {
  return {
    cashPaisa: Number(raw?.cashPaisa ?? 0),
    cashTipPaisa: Number(raw?.cashTipPaisa ?? 0),
    totalPaisa: Number(raw?.totalPaisa ?? 0),
    tipPaisa: Number(raw?.tipPaisa ?? 0),
    orderCount: Number(raw?.orderCount ?? 0),
    paymentCount: Number(raw?.paymentCount ?? 0),
  };
}

export function adaptDailyTakings(raw: any): DailyTakings {
  const rawUnknowns: UnknownFigure[] = (raw.unknowns ?? []).map((u: any) => ({
    figure: String(u.figure),
    reason: String(u.reason),
  }));

  const byField = new Map<string, UnknownFigure>();
  const residualUnknowns: UnknownFigure[] = [];
  for (const u of rawUnknowns) {
    const field = FIGURE_KEY_TO_FIELD[u.figure];
    if (field) byField.set(field, u);
    else residualUnknowns.push(u);
  }

  /** KNOWN unless the server named this field in `unknowns`. */
  const figure = (field: string, paisa: any): MoneyFigure => {
    const stated = byField.get(field);
    if (stated) return unknown(stated.figure, stated.reason);
    return { state: "KNOWN", paisa: Number(paisa ?? 0) };
  };

  const compsUnknown = byField.get("comps");
  const cashVarianceUnknown = byField.get("dayCashVariance");

  return {
    businessDate: raw.businessDate,
    branchId: raw.branchId ?? null,
    gross: figure("gross", raw.grossSalesPaisa),
    discounts: figure("discounts", raw.discountsPaisa),
    // The API carries NO comps amount at all — a full comp is recorded in `discount_paisa` and the
    // schema cannot split it. So comps is UNKNOWN when the server says why, and still UNKNOWN
    // (with that stated) when it says nothing. There is no branch in which comps becomes a zero.
    comps: compsUnknown
      ? unknown(compsUnknown.figure, compsUnknown.reason)
      : unknown(
          "comps",
          "The server stated no comps figure for this day, and this screen will not invent one.",
        ),
    tax: figure("tax", raw.taxPaisa),
    serviceCharge: figure("serviceCharge", raw.serviceChargePaisa),
    // `netSalesPaisa` is gross − discounts, tax EXCLUDED, and `totalBilledPaisa` is the bill
    // total. They were ONE field before F5 — the bill total under the name of net — which is why
    // the screen showed a net larger than its own gross. Both are carried through untouched; the
    // adapter still does no arithmetic, so if the server ever regresses, the screen shows the
    // regression instead of hiding it behind a re-derivation here.
    net: figure("net", raw.netSalesPaisa),
    totalBilled: figure("totalBilled", raw.totalBilledPaisa),
    orderCount: Number(raw.orderCount ?? 0),
    byTender: (raw.byTender ?? []).map(adaptTenderLine),
    tills: (raw.tills ?? []).map(adaptTillReconciliation),
    unclosed: adaptUnclosedTakings(raw.unclosed),
    dayCashVariance: cashVarianceUnknown
      ? unknown(cashVarianceUnknown.figure, cashVarianceUnknown.reason)
      : null,
    residualUnknowns,
  };
}

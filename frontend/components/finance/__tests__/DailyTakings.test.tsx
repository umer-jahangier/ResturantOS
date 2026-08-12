import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { adaptDailyTakings } from "@/lib/adapters/takings.adapter";
import { TenderSplit } from "@/components/finance/TenderSplit";
import { TillVariancePanel } from "@/components/finance/TillVariancePanel";
import { FigureValue, UnknownFigure } from "@/components/finance/UnknownFigure";
import type { MoneyFigure } from "@/lib/models/takings.model";

/**
 * 37-12. The fixtures below are the LIVE response, captured from
 * `GET /api/v1/pos/takings/daily?date=2026-08-06` against the running stack — not the shape the
 * plan assumed. The plan expected each figure to arrive as a two-state union; the API returns bare
 * numbers plus a side list of `unknowns` keyed by figure name. The union is assembled in the
 * adapter, which is exactly why the adapter is tested here rather than trusted.
 */

const LIVE_2026_08_06 = {
  businessDate: "2026-08-06",
  branchId: null,
  grossSalesPaisa: 3339000,
  discountsPaisa: 0,
  netSalesPaisa: 3339000,
  taxPaisa: 534240,
  serviceChargePaisa: 0,
  totalBilledPaisa: 3873240,
  orderCount: 26,
  byTender: [
    { method: "CARD", amountPaisa: 1006880, paymentCount: 8 },
    { method: "CASH", amountPaisa: 2866360, paymentCount: 18 },
  ],
  tills: [
    {
      tillSessionId: "74e7bfdc-262b-42bb-aab4-e89dfbf77347",
      cashierId: "eb2ee67e-9fc0-4ed5-bb5b-cd6321e02ba1",
      status: "OPEN",
      openingFloatPaisa: 500000,
      expectedClosingPaisa: null,
      declaredClosingPaisa: null,
      variancePaisa: null,
      openedAt: "2026-08-07T01:39:26.691885Z",
      closedAt: null,
      reconciliationState: "OPEN",
    },
    {
      tillSessionId: "ea929b37-910a-419c-b747-9a396b1b258a",
      cashierId: "61334688-6b5c-4926-ac82-e93208ba5324",
      status: "CLOSED",
      openingFloatPaisa: 5,
      expectedClosingPaisa: 683605,
      declaredClosingPaisa: 4356700,
      variancePaisa: 3673095,
      openedAt: "2026-08-07T01:56:36.688789Z",
      closedAt: "2026-08-08T19:35:18.196620Z",
      reconciliationState: "OVER",
    },
  ],
  unknowns: [
    {
      figure: "comps",
      reason:
        "Comps are not recorded separately from discounts. orders.discount_paisa is one column, and a full comp appears in it as a discount equal to the subtotal. Splitting them would require a field POS does not capture.",
    },
  ],
};

const LIVE_2026_08_08_CASH_VARIANCE_UNKNOWN = {
  ...LIVE_2026_08_06,
  businessDate: "2026-08-08",
  tills: [LIVE_2026_08_06.tills[0]],
  unknowns: [
    ...LIVE_2026_08_06.unknowns,
    {
      figure: "cash variance",
      reason:
        "Cash was taken on this day but no till was closed and counted, so there is nothing to compare the expected drawer against. This is NOT a zero variance.",
    },
  ],
};

/**
 * S0-02, captured live from `GET /api/v1/pos/takings/daily` after ringing Rs 77.00 CASH on an
 * order that was sent to the kitchen and never served.
 *
 * Every sales figure is zero — nothing has been SOLD, because nothing has been closed — while
 * Rs 77.00 is in the drawer. That combination is the ordinary evening state of a busy restaurant
 * (POS-23 closes an order only when it is paid AND served), and the screen used to render it as
 * "No trading recorded on this date".
 */
const LIVE_OPEN_ORDER_CASH = {
  businessDate: "2026-08-11",
  branchId: null,
  grossSalesPaisa: 0,
  discountsPaisa: 0,
  netSalesPaisa: 0,
  taxPaisa: 0,
  serviceChargePaisa: 0,
  totalBilledPaisa: 0,
  orderCount: 0,
  byTender: [
    {
      method: "CARD",
      amountPaisa: 50000,
      paymentCount: 1,
      unclosedAmountPaisa: 0,
      unclosedPaymentCount: 0,
    },
    {
      method: "CASH",
      amountPaisa: 7700,
      paymentCount: 1,
      unclosedAmountPaisa: 7700,
      unclosedPaymentCount: 1,
    },
  ],
  tills: [],
  unclosed: { cashPaisa: 7700, totalPaisa: 7700, orderCount: 1, paymentCount: 1 },
  unknowns: [],
};

/**
 * F20 — the day the drawer expectation stopped being explainable.
 *
 * Measured at Floating Terrace HQ on 2026-08-12: Rs 185.00 of CASH tips and Rs 300.00 of CARD
 * tips. `TillServiceImpl.closeTill` counts a cash tip into `expected_closing_paisa` — the guest
 * physically put the note in the drawer — so the till below expects
 * `3000.00 float + 250.00 cash + 185.00 tip = 3435.00`. The tender split summed `amount_paisa`
 * alone, so the same page showed Rs 250.00 of cash against an expectation of Rs 3,435.00 and the
 * word "tip" appeared NOWHERE on it.
 *
 * The card tip is in the fixture on purpose: it must be reported AND must not be in the drawer,
 * which is the whole argument for a per-tender column over one "tips" row.
 */
const LIVE_2026_08_12_TIPS = {
  businessDate: "2026-08-12",
  branchId: null,
  grossSalesPaisa: 50000,
  discountsPaisa: 0,
  netSalesPaisa: 50000,
  taxPaisa: 0,
  serviceChargePaisa: 0,
  totalBilledPaisa: 50000,
  orderCount: 2,
  byTender: [
    {
      method: "CARD",
      amountPaisa: 25000,
      tipPaisa: 30000,
      paymentCount: 1,
      unclosedAmountPaisa: 0,
      unclosedPaymentCount: 0,
    },
    {
      method: "CASH",
      amountPaisa: 25000,
      tipPaisa: 18500,
      paymentCount: 1,
      unclosedAmountPaisa: 0,
      unclosedPaymentCount: 0,
    },
  ],
  tills: [
    {
      tillSessionId: "b17269cb-0000-4000-8000-000000000001",
      cashierId: "61334688-6b5c-4926-ac82-e93208ba5324",
      status: "CLOSED",
      openingFloatPaisa: 300000,
      expectedClosingPaisa: 343500,
      declaredClosingPaisa: 343500,
      variancePaisa: 0,
      openedAt: "2026-08-12T05:00:00.000000Z",
      closedAt: "2026-08-12T20:00:00.000000Z",
      reconciliationState: "MATCHED",
    },
  ],
  unclosed: { cashPaisa: 0, cashTipPaisa: 0, totalPaisa: 0, tipPaisa: 0, orderCount: 0, paymentCount: 0 },
  unknowns: [],
};

/** The same day, but the tipped cash bill has not been served yet — so it cannot close. */
const LIVE_TIP_ON_AN_OPEN_BILL = {
  ...LIVE_2026_08_12_TIPS,
  grossSalesPaisa: 0,
  netSalesPaisa: 0,
  totalBilledPaisa: 0,
  orderCount: 0,
  byTender: [
    {
      method: "CASH",
      amountPaisa: 25000,
      tipPaisa: 18500,
      paymentCount: 1,
      unclosedAmountPaisa: 25000,
      unclosedPaymentCount: 1,
    },
  ],
  tills: [],
  unclosed: {
    cashPaisa: 25000,
    cashTipPaisa: 18500,
    totalPaisa: 25000,
    tipPaisa: 18500,
    orderCount: 1,
    paymentCount: 1,
  },
};

// GUIDE-CLAIM: FIN-GUIDE-0009
// GUIDE-CLAIM: FIN-GUIDE-0011
describe("takings adapter — the union assembled from the live wire shape", () => {
  it("keeps a stated amount as KNOWN, in paisa, untouched", () => {
    const t = adaptDailyTakings(LIVE_2026_08_06);
    expect(t.gross).toEqual({ state: "KNOWN", paisa: 3339000 });
    expect(t.net).toEqual({ state: "KNOWN", paisa: 3339000 });
    expect(t.totalBilled).toEqual({ state: "KNOWN", paisa: 3873240 });
  });

  it("carries net sales and total billed as TWO figures, not one", () => {
    // F5. They were one field — the bill total under the name `netSalesPaisa` — so the screen
    // rendered NET SALES above GROSS SALES and an accountant reading it over-stated revenue by
    // the entire output-tax line. Two names, two numbers, and the tax lives in exactly one.
    const t = adaptDailyTakings(LIVE_2026_08_06);
    expect(t.net).not.toEqual(t.totalBilled);
  });

  it("does no arithmetic: net is the server's number, not gross − discounts", () => {
    const t = adaptDailyTakings({ ...LIVE_2026_08_06, netSalesPaisa: 99 });
    // A derived net would be 3,339,000. The adapter renders what it was told, even when absurd —
    // that is what makes a server-side defect visible instead of quietly patched over.
    expect(t.net).toEqual({ state: "KNOWN", paisa: 99 });
  });

  it("a figure named in `unknowns` becomes UNKNOWN and carries NO amount", () => {
    const t = adaptDailyTakings(LIVE_2026_08_06);
    expect(t.comps.state).toBe("UNKNOWN");
    expect(t.comps).not.toHaveProperty("paisa");
  });

  it("comps is UNKNOWN even when the server names nothing — never a zero", () => {
    const t = adaptDailyTakings({ ...LIVE_2026_08_06, unknowns: [] });
    expect(t.comps.state).toBe("UNKNOWN");
    expect(t.comps).not.toHaveProperty("paisa");
  });

  it("a day-level cash-variance unknown is surfaced separately from the per-till figures", () => {
    expect(adaptDailyTakings(LIVE_2026_08_06).dayCashVariance).toBeNull();
    const t = adaptDailyTakings(LIVE_2026_08_08_CASH_VARIANCE_UNKNOWN);
    expect(t.dayCashVariance?.reason).toContain("NOT a zero variance");
  });

  it("an unrecognised figure name degrades to the residual list rather than vanishing", () => {
    const t = adaptDailyTakings({
      ...LIVE_2026_08_06,
      unknowns: [{ figure: "tips", reason: "Tips are not captured by POS." }],
    });
    expect(t.residualUnknowns).toEqual([
      { figure: "tips", reason: "Tips are not captured by POS." },
    ]);
  });

  it("OPEN and NOT_COUNTED both have a null variance and produce DIFFERENT reasons", () => {
    const open = adaptDailyTakings(LIVE_2026_08_06).tills[0]!;
    const notCounted = adaptDailyTakings({
      ...LIVE_2026_08_06,
      tills: [
        {
          ...LIVE_2026_08_06.tills[0],
          status: "CLOSED",
          closedAt: "2026-08-07T03:00:00Z",
          reconciliationState: "NOT_COUNTED",
        },
      ],
    }).tills[0]!;

    expect(open.variance.state).toBe("UNKNOWN");
    expect(notCounted.variance.state).toBe("UNKNOWN");
    const openReason = (open.variance as { reason: string }).reason;
    const notCountedReason = (notCounted.variance as { reason: string }).reason;
    expect(openReason).not.toBe(notCountedReason);
    expect(openReason).toContain("still open");
    expect(notCountedReason).toContain("without anyone counting");
  });

  it("keeps the server's variance sign — it does not flip or absolutise it", () => {
    const short = adaptDailyTakings({
      ...LIVE_2026_08_06,
      tills: [
        { ...LIVE_2026_08_06.tills[1]!, variancePaisa: -25000, reconciliationState: "SHORT" },
      ],
    }).tills[0]!;
    expect(short.variance).toEqual({ state: "KNOWN", paisa: -25000 });
  });
});

// GUIDE-CLAIM: FIN-GUIDE-0009
describe("FigureValue — a zero and an unknown are not the same thing", () => {
  const zero: MoneyFigure = { state: "KNOWN", paisa: 0 };
  const unknown: MoneyFigure = {
    state: "UNKNOWN",
    figureKey: "comps",
    reason: "Comps are not recorded separately from discounts.",
  };

  it("renders a genuine zero as money", () => {
    render(<FigureValue figure={zero} />);
    expect(screen.getByTestId("known-figure")).toHaveTextContent("Rs 0.00");
    expect(screen.queryByTestId("unknown-figure")).not.toBeInTheDocument();
  });

  it("renders an unknown as a reason where the number would have been, never as 0 or a dash", () => {
    render(<FigureValue figure={unknown} />);
    const el = screen.getByTestId("unknown-figure");
    expect(el).toHaveTextContent("Not known");
    expect(el).toHaveTextContent("Comps are not recorded separately");
    expect(el.textContent).not.toMatch(/Rs\s*0\.00/);
    expect(el.textContent).not.toBe("—");
    expect(screen.queryByTestId("known-figure")).not.toBeInTheDocument();
  });

  it("reads to a screen reader as an absence, with the reason", () => {
    render(<UnknownFigure figure={unknown as Extract<MoneyFigure, { state: "UNKNOWN" }>} />);
    expect(screen.getByTestId("unknown-figure")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("not known"),
    );
  });

  it("renders every amount through formatPaisa — two decimal places, Rs prefix", () => {
    render(<FigureValue figure={{ state: "KNOWN", paisa: 3673095 }} signed />);
    // Rs 36,730.95 — the OVER variance in the seeded data. If this reads Rs 36,731 the screen has
    // acquired a second money formatter and no longer agrees with the printed bill (37-01).
    expect(screen.getByTestId("known-figure")).toHaveTextContent("+Rs 36,730.95");
  });
});

describe("TenderSplit — observed methods only", () => {
  it("lists exactly what the server observed, with counts", () => {
    render(<TenderSplit lines={adaptDailyTakings(LIVE_2026_08_06).byTender} />);
    expect(screen.getByTestId("tender-row-CARD")).toHaveTextContent("Rs 10,068.80");
    expect(screen.getByTestId("tender-row-CASH")).toHaveTextContent("Rs 28,663.60");
    // WALLET was never seen, so it is ABSENT — not present at zero.
    expect(screen.queryByTestId("tender-row-WALLET")).not.toBeInTheDocument();
  });

  it("says no payments were taken rather than drawing a zero row", () => {
    render(<TenderSplit lines={[]} />);
    expect(screen.getByTestId("tender-split-empty")).toBeInTheDocument();
  });

  // S0-02. The unclosed portion is a SUBSET of the line's own amount, so it is a column on that
  // line. A reader who adds the two columns must get a number that is wrong, not a number that
  // looks plausible — hence the amount column keeps the full figure.
  it("shows the unclosed portion as part of the line, not as extra money", () => {
    render(
      <TenderSplit
        lines={adaptDailyTakings(LIVE_OPEN_ORDER_CASH).byTender}
      />,
    );
    expect(screen.getByTestId("tender-amount-CASH")).toHaveAttribute("data-paisa", "7700");
    expect(screen.getByTestId("tender-unclosed-CASH")).toHaveAttribute("data-paisa", "7700");
    // CARD took money on bills that were finalised, so nothing of it is outstanding — an em dash,
    // never "Rs 0.00", which reads as a computed figure rather than as "none".
    expect(screen.getByTestId("tender-unclosed-CARD")).toHaveTextContent("—");
  });

  // ── F20 ────────────────────────────────────────────────────────────────────────────────────
  // The tip column is the opposite of the unclosed one: an ADDITION, not a subset. Both rules are
  // asserted in the same file so a future edit that makes them behave alike breaks something.

  it("states the tip per tender, and never inside the amount that settled the bill", () => {
    const t = adaptDailyTakings(LIVE_2026_08_12_TIPS);
    render(<TenderSplit lines={t.byTender} />);

    // Rs 185.00 cash, Rs 300.00 card — reported apart, because only one of them is in a drawer.
    expect(screen.getByTestId("tender-tip-CASH")).toHaveAttribute("data-paisa", "18500");
    expect(screen.getByTestId("tender-tip-CARD")).toHaveAttribute("data-paisa", "30000");
    expect(screen.getByTestId("tender-tip-CASH")).toHaveTextContent("Rs 185.00");

    // The amount is untouched by the tip. A tip is not revenue and never entered the bill, so
    // folding it in here would stop the split reconciling against TOTAL BILLED.
    expect(screen.getByTestId("tender-amount-CASH")).toHaveAttribute("data-paisa", "25000");
    expect(screen.getByTestId("tender-amount-CARD")).toHaveAttribute("data-paisa", "25000");
  });

  /**
   * The reconciliation, asserted on the rendered page rather than in prose: the till's EXPECTED
   * CASH must be reachable from the two numbers printed above it. This is the arithmetic an owner
   * does at the counter, and before F20 it did not come out — the page was short by Rs 185.00 and
   * said nothing about why.
   *
   * The screen itself still computes NOTHING (T-32-12-E). This test does the addition precisely
   * because the page must not: it is checking that the FIGURES the server stated are mutually
   * consistent, which is a property of the response, not a feature of the component.
   */
  it("prints the cash figures a drawer expectation can actually be rebuilt from", () => {
    const t = adaptDailyTakings(LIVE_2026_08_12_TIPS);
    render(<TenderSplit lines={t.byTender} />);

    const cashAmount = Number(
      screen.getByTestId("tender-amount-CASH").getAttribute("data-paisa"),
    );
    const cashTip = Number(screen.getByTestId("tender-tip-CASH").getAttribute("data-paisa"));
    const till = t.tills[0];
    if (!till) throw new Error("fixture must carry the closed till this identity is about");
    // Not a fallback to 0: an UNKNOWN expected closing means nobody counted, and reconciling
    // against a zero would report a matched drawer on a till that was never cashed up.
    if (till.expectedClosing.state !== "KNOWN") {
      throw new Error("fixture must state an expected closing — a dash cannot be reconciled");
    }
    const expected = till.expectedClosing.paisa;

    expect(till.openingFloatPaisa + cashAmount + cashTip).toBe(expected);
    // And the part the amount alone leaves unexplained IS the cash tip — the assertion that fails
    // by exactly Rs 185.00 on a build whose server omits the figure.
    expect(expected - till.openingFloatPaisa - cashAmount).toBe(18500);

    // The card tip is on the page and is NOT in the drawer. One combined "tips" row would have
    // sent the cashier looking for Rs 300.00 that was never there.
    expect(
      till.openingFloatPaisa + cashAmount + cashTip + 30000,
    ).not.toBe(expected);
  });

  it("draws an em dash for a tender that took no tip, never Rs 0.00", () => {
    render(<TenderSplit lines={adaptDailyTakings(LIVE_OPEN_ORDER_CASH).byTender} />);
    // Present-and-checked, not merely absent: the cell must exist and say "none".
    expect(screen.getByTestId("tender-tip-CASH")).toHaveTextContent("—");
    expect(screen.getByTestId("tender-tip-CASH")).toHaveAttribute("data-paisa", "0");
  });
});

// GUIDE-CLAIM: FIN-GUIDE-0010
// GUIDE-CLAIM: FIN-GUIDE-0011
describe("TillVariancePanel — the reason this screen exists", () => {
  it("shows the seeded Rs 36,730.95 overage as a signed variance on that till alone", () => {
    const t = adaptDailyTakings(LIVE_2026_08_06);
    render(<TillVariancePanel tills={t.tills} dayCashVariance={t.dayCashVariance} />);

    const overRow = screen.getByTestId("till-row-ea929b37-910a-419c-b747-9a396b1b258a");
    expect(within(overRow).getByTestId("till-variance")).toHaveTextContent("+Rs 36,730.95");
    expect(within(overRow).getByText("Over")).toBeInTheDocument();
    expect(overRow).toHaveTextContent("Rs 6,836.05"); // expected
    expect(overRow).toHaveTextContent("Rs 43,567.00"); // counted
  });

  it("renders an OPEN till differently from a NOT_COUNTED till — not the same dash", () => {
    const t = adaptDailyTakings({
      ...LIVE_2026_08_06,
      tills: [
        LIVE_2026_08_06.tills[0],
        {
          ...LIVE_2026_08_06.tills[1]!,
          tillSessionId: "11111111-1111-1111-1111-111111111111",
          expectedClosingPaisa: null,
          declaredClosingPaisa: null,
          variancePaisa: null,
          reconciliationState: "NOT_COUNTED",
        },
      ],
    });
    render(<TillVariancePanel tills={t.tills} />);

    const openRow = screen.getByTestId("till-row-74e7bfdc-262b-42bb-aab4-e89dfbf77347");
    const notCountedRow = screen.getByTestId("till-row-11111111-1111-1111-1111-111111111111");

    expect(within(openRow).getByText("Still open")).toBeInTheDocument();
    expect(within(notCountedRow).getByText("Not counted")).toBeInTheDocument();

    const openLabel = within(openRow)
      .getAllByTestId("unknown-figure")[2]!
      .getAttribute("aria-label");
    const notCountedLabel = within(notCountedRow)
      .getAllByTestId("unknown-figure")[2]!
      .getAttribute("aria-label");
    expect(openLabel).not.toBe(notCountedLabel);
  });

  it("shows a shortfall and an overage distinctly, and neither as an error", () => {
    const t = adaptDailyTakings({
      ...LIVE_2026_08_06,
      tills: [
        LIVE_2026_08_06.tills[1]!,
        {
          ...LIVE_2026_08_06.tills[1]!,
          tillSessionId: "22222222-2222-2222-2222-222222222222",
          variancePaisa: -3673095,
          reconciliationState: "SHORT",
        },
      ],
    });
    render(<TillVariancePanel tills={t.tills} />);

    const over = screen.getByTestId("till-row-ea929b37-910a-419c-b747-9a396b1b258a");
    const short = screen.getByTestId("till-row-22222222-2222-2222-2222-222222222222");
    expect(within(over).getByTestId("till-variance")).toHaveTextContent("+Rs 36,730.95");
    expect(within(short).getByTestId("till-variance")).toHaveTextContent("-Rs 36,730.95");
    expect(within(over).getByTestId("till-variance").className).not.toBe(
      within(short).getByTestId("till-variance").className,
    );
    // Neither is announced as an error — they are facts a manager investigates.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never nets two opposite variances into one figure", () => {
    const t = adaptDailyTakings({
      ...LIVE_2026_08_06,
      tills: [
        LIVE_2026_08_06.tills[1]!,
        {
          ...LIVE_2026_08_06.tills[1]!,
          tillSessionId: "22222222-2222-2222-2222-222222222222",
          variancePaisa: -3673095,
          reconciliationState: "SHORT",
        },
      ],
    });
    render(<TillVariancePanel tills={t.tills} />);
    // Two variances, both visible. No third "total" figure exists to hide them behind.
    expect(screen.getAllByTestId("till-variance")).toHaveLength(2);
    expect(screen.queryByText(/total variance/i)).not.toBeInTheDocument();
  });

  it("states a day-level unknown cash variance as its own banner, not as a zero", () => {
    const t = adaptDailyTakings(LIVE_2026_08_08_CASH_VARIANCE_UNKNOWN);
    render(<TillVariancePanel tills={t.tills} dayCashVariance={t.dayCashVariance} />);
    const banner = screen.getByTestId("day-cash-variance-unknown");
    expect(banner).toHaveTextContent("not known");
    expect(banner).toHaveTextContent("NOT a zero variance");
  });

  it("names the cashier when the roster is available and degrades gracefully when it is not", () => {
    const t = adaptDailyTakings(LIVE_2026_08_06);
    const { rerender } = render(<TillVariancePanel tills={t.tills} />);
    expect(screen.getByTestId("till-row-ea929b37-910a-419c-b747-9a396b1b258a")).toHaveTextContent(
      "Cashier 61334688",
    );
    rerender(
      <TillVariancePanel
        tills={t.tills}
        cashierNames={new Map([["61334688-6b5c-4926-ac82-e93208ba5324", "Asif Raza"]])}
      />,
    );
    expect(screen.getByTestId("till-row-ea929b37-910a-419c-b747-9a396b1b258a")).toHaveTextContent(
      "Asif Raza",
    );
  });

  it("says no till was opened rather than implying a counted, matching drawer", () => {
    render(<TillVariancePanel tills={[]} />);
    expect(screen.getByTestId("tills-empty")).toHaveTextContent("No till was opened");
  });
});

/**
 * The composed screen. `DailyTakings` reaches for the router and two hooks, so the failure-vs-empty
 * contract is exercised here through mocked hooks — the distinction GA-001 exists to protect is the
 * single most important behaviour on this screen and cannot go untested.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/app/finance/takings",
  useSearchParams: () => new URLSearchParams("date=2026-08-06"),
}));

const takingsQuery = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/hooks/finance/use-daily-takings", () => ({
  useDailyTakings: () => takingsQuery.current,
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useUsers: () => ({ data: undefined, isError: true, isPending: false }),
}));

describe("DailyTakings — a failed request is never a day with no sales", () => {
  it("renders the error with a retry, not an empty state", async () => {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: true,
      error: new Error("boom"),
      isPending: false,
      refetch: vi.fn(),
      data: undefined,
    };
    render(<DailyTakings />);
    expect(screen.getByTestId("query-error")).toBeInTheDocument();
    expect(screen.queryByText(/No trading recorded/i)).not.toBeInTheDocument();
  });

  it("renders a distinct empty state when the day genuinely had no trading", async () => {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings({
        businessDate: "2026-01-01",
        branchId: null,
        grossSalesPaisa: 0,
        discountsPaisa: 0,
        netSalesPaisa: 0,
        taxPaisa: 0,
        serviceChargePaisa: 0,
        totalBilledPaisa: 0,
        orderCount: 0,
        byTender: [],
        tills: [],
        unknowns: LIVE_2026_08_06.unknowns,
      }),
    };
    render(<DailyTakings />);
    expect(screen.getByText(/No trading recorded on this date/i)).toBeInTheDocument();
    expect(screen.queryByTestId("query-error")).not.toBeInTheDocument();
  });

  it("renders the day's figures, the tender split and every till", async () => {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings(LIVE_2026_08_06),
    };
    render(<DailyTakings />);
    expect(screen.getByTestId("figure-tile-gross-sales")).toHaveTextContent("Rs 33,390.00");
    expect(screen.getByTestId("figure-tile-net-sales")).toHaveTextContent("Rs 33,390.00");
    expect(screen.getByTestId("figure-tile-total-billed")).toHaveTextContent("Rs 38,732.40");
    // Comps is the one figure the schema cannot state. It says so, in place of a number.
    expect(
      within(screen.getByTestId("figure-tile-comps")).getByTestId("unknown-figure"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tender-row-CASH")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^till-row-/)).toHaveLength(2);
    expect(screen.getByTestId("takings-date")).toHaveValue("2026-08-06");
  });
});

/**
 * F5 — a tile labelled "net" that reads LARGER than the gross tile above it.
 *
 * The figures below are the real response for business date 2026-08-11 on the Floating Terrace
 * tenant, the day the walkthrough caught this: GROSS Rs 43,350.00, DISCOUNTS Rs 950.00,
 * TAX Rs 3,566.40 — and NET SALES Rs 45,966.40, because "net" carried `SUM(orders.total_paisa)`.
 *
 * These assertions are made against the RENDERED PAGE, by reading the money out of each tile the
 * way the person cashing up reads it. Asserting the component's props instead would have passed
 * throughout the defect: the props were faithfully the number the server sent, and the number the
 * server sent was the wrong one for the word above it.
 */
describe("DailyTakings — no figure called 'net' may exceed gross (F5)", () => {
  const LIVE_2026_08_11_DISCOUNTED_AND_TAXED = {
    ...LIVE_2026_08_06,
    businessDate: "2026-08-11",
    grossSalesPaisa: 4335000,
    discountsPaisa: 95000,
    netSalesPaisa: 4240000, // 43,350.00 − 950.00
    taxPaisa: 356640,
    serviceChargePaisa: 0,
    totalBilledPaisa: 4596640, // 42,400.00 + 3,566.40
    orderCount: 33,
  };

  /** The money a human would read off a tile, in paisa. Text in, number out — no props. */
  function renderedPaisa(testId: string): number {
    const text = screen.getByTestId(testId).textContent ?? "";
    const match = text.match(/Rs\s*([\d,]+\.\d{2})/);
    if (!match) throw new Error(`no money rendered in ${testId}: "${text}"`);
    return Math.round(Number(match[1]!.replace(/,/g, "")) * 100);
  }

  async function renderDiscountedTaxedDay() {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings(LIVE_2026_08_11_DISCOUNTED_AND_TAXED),
    };
    render(<DailyTakings />);
  }

  it("shows net sales as gross less discounts, smaller than gross", async () => {
    await renderDiscountedTaxedDay();

    const gross = renderedPaisa("figure-tile-gross-sales");
    const discounts = renderedPaisa("figure-tile-discounts");
    const net = renderedPaisa("figure-tile-net-sales");

    expect(gross).toBe(4335000);
    expect(discounts).toBe(95000);
    expect(net).toBe(gross - discounts);
    expect(net).toBeLessThan(gross);
  });

  it("keeps tax out of net sales and shows it on its own tile", async () => {
    await renderDiscountedTaxedDay();

    const net = renderedPaisa("figure-tile-net-sales");
    const tax = renderedPaisa("figure-tile-tax");

    expect(tax).toBe(356640);
    // The pre-F5 screen rendered exactly this sum under the word "net".
    expect(net).not.toBe(4335000 - 95000 + 356640);
  });

  it("gives the bill total its own tile, correctly named, and reconciles the six", async () => {
    await renderDiscountedTaxedDay();

    const net = renderedPaisa("figure-tile-net-sales");
    const tax = renderedPaisa("figure-tile-tax");
    const service = renderedPaisa("figure-tile-service-charge");
    const totalBilled = renderedPaisa("figure-tile-total-billed");

    expect(totalBilled).toBe(4596640);
    expect(totalBilled).toBe(net + tax + service);
    // The old bug in one line: this number is bigger than gross, and it must not be called net.
    expect(totalBilled).toBeGreaterThan(renderedPaisa("figure-tile-gross-sales"));
    expect(screen.getByTestId("figure-tile-total-billed")).toHaveTextContent(/total billed/i);
  });

  it("captions each tile with what that tile's own figure means", async () => {
    await renderDiscountedTaxedDay();

    // "What the bills actually came to" described a TOTAL and sat under the word "net". Whichever
    // way the defect is fixed, the sentence has to describe the number directly above it.
    expect(screen.getByTestId("figure-tile-net-sales")).toHaveTextContent(
      /gross sales less discounts/i,
    );
    expect(screen.getByTestId("figure-tile-net-sales")).toHaveTextContent(
      /not in this figure|revenue line/i,
    );
    expect(screen.getByTestId("figure-tile-tax")).toHaveTextContent(/not inside net sales/i);
    expect(screen.getByTestId("figure-tile-total-billed")).toHaveTextContent(
      /what the bills actually came to/i,
    );
    expect(screen.getByTestId("takings-identity")).toHaveTextContent(
      "Gross sales − discounts = net sales. Net sales + tax + service charge = total billed.",
    );
  });
});

/**
 * S0-02 — the money is on the screen, and the screen says where it is sitting.
 *
 * The backend fix alone does not close this gap. With the cash restored to the tender split, a day
 * whose orders are all still open has zero closed orders and zero tills, and the old emptiness
 * test (`orderCount === 0 && tills.length === 0`) still painted "No trading recorded on this date"
 * straight over the figures. That is this repo's signature failure — structurally present,
 * behaviourally absent — reproduced one layer up, so it is asserted one layer up.
 */
describe("DailyTakings — cash on an open order (S0-02)", () => {
  async function renderOpenOrderDay() {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings(LIVE_OPEN_ORDER_CASH),
    };
    render(<DailyTakings />);
  }

  it("does not call a day with money in the drawer an empty day", async () => {
    await renderOpenOrderDay();
    expect(screen.queryByText(/No trading recorded on this date/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("tender-row-CASH")).toHaveTextContent("Rs 77.00");
  });

  it("states on-screen how much of the day's cash is against orders not yet closed", async () => {
    await renderOpenOrderDay();
    const panel = screen.getByTestId("unclosed-tender-panel");
    expect(panel).toHaveAttribute("data-unclosed-cash-paisa", "7700");
    expect(panel).toHaveTextContent("Rs 77.00");
    expect(panel).toHaveTextContent(/1 order that is not closed yet/i);
    // It must also say the money is NOT in gross/net/total, or the two bases look like a
    // contradiction — and it has to name all three tiles, not the two that existed before F5.
    expect(panel).toHaveTextContent(/not in gross, net sales or total billed/i);
  });

  it("says so plainly when nothing is being held against an open bill", async () => {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings(LIVE_2026_08_06),
    };
    render(<DailyTakings />);
    // Always present, never conditional: "all of today's money is on closed bills" is the answer
    // a manager needs before accepting a drawer variance as real.
    expect(screen.getByTestId("unclosed-none")).toBeInTheDocument();
  });
});

/**
 * F20 — the screen names the tip, in the section whose copy already promised the drawer.
 *
 * "How it came in" told the reader this was "what the drawers and the card terminals took today"
 * and the unclosed panel told them to "expect the count to include it". Both sentences were being
 * made about the bill amounts alone, so a cashier who trusted them was short by exactly the cash
 * tips — Rs 185.00 on the measured day — with no word on the page to explain the difference.
 */
describe("DailyTakings — the tip on the page (F20)", () => {
  async function renderDay(raw: unknown) {
    const { DailyTakings } = await import("@/components/finance/DailyTakings");
    takingsQuery.current = {
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      data: adaptDailyTakings(raw),
    };
    render(<DailyTakings />);
  }

  it("says the word, and says which side of the bill a tip is on", async () => {
    await renderDay(LIVE_2026_08_12_TIPS);
    // The rule has to be on the page, not only in the numbers: a column that ADDS sits beside a
    // column that is a SUBSET, which is exactly the pair a tired reader gets backwards.
    const note = screen.getByTestId("tender-tip-note");
    expect(note).toHaveTextContent(/on top of/i);
    expect(note).toHaveTextContent(/cash/i);
    expect(screen.getByTestId("tender-tip-CASH")).toHaveTextContent("Rs 185.00");
  });

  it("keeps the tip out of every sales tile", async () => {
    await renderDay(LIVE_2026_08_12_TIPS);
    // A tip is not revenue — it never enters orders.total_paisa and finance books it as a
    // liability owed to staff. Rs 500.00 billed, Rs 485.00 tipped, and the tiles show the bill.
    expect(screen.getByTestId("figure-tile-gross-sales")).toHaveTextContent("Rs 500.00");
    expect(screen.getByTestId("figure-tile-net-sales")).toHaveTextContent("Rs 500.00");
    expect(screen.getByTestId("figure-tile-total-billed")).toHaveTextContent("Rs 500.00");
  });

  it("adds the cash tip on an open bill to what the counter is told to expect", async () => {
    await renderDay(LIVE_TIP_ON_AN_OPEN_BILL);
    const panel = screen.getByTestId("unclosed-tender-panel");
    expect(panel).toHaveAttribute("data-unclosed-cash-tip-paisa", "18500");
    // Wait FOR the sentence rather than for its absence: a tip in the drawer that the panel does
    // not mention is reported by the cashier as an overage that is the restaurant's own gratuity.
    expect(screen.getByTestId("unclosed-cash-tip-amount")).toHaveTextContent("Rs 185.00");
    expect(panel).toHaveTextContent(/never a sale/i);
  });
});

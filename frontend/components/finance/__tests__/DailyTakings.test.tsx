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
  taxPaisa: 534240,
  serviceChargePaisa: 0,
  netSalesPaisa: 3873240,
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

// GUIDE-CLAIM: FIN-GUIDE-0009
// GUIDE-CLAIM: FIN-GUIDE-0011
describe("takings adapter — the union assembled from the live wire shape", () => {
  it("keeps a stated amount as KNOWN, in paisa, untouched", () => {
    const t = adaptDailyTakings(LIVE_2026_08_06);
    expect(t.gross).toEqual({ state: "KNOWN", paisa: 3339000 });
    expect(t.net).toEqual({ state: "KNOWN", paisa: 3873240 });
  });

  it("does no arithmetic: net is the server's number, not gross − discounts + tax", () => {
    const t = adaptDailyTakings({ ...LIVE_2026_08_06, netSalesPaisa: 99 });
    // A derived net would be 3,873,240. The adapter renders what it was told, even when absurd —
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
        taxPaisa: 0,
        serviceChargePaisa: 0,
        netSalesPaisa: 0,
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
    expect(screen.getByTestId("figure-tile-net-sales")).toHaveTextContent("Rs 38,732.40");
    // Comps is the one figure the schema cannot state. It says so, in place of a number.
    expect(
      within(screen.getByTestId("figure-tile-comps")).getByTestId("unknown-figure"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tender-row-CASH")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^till-row-/)).toHaveLength(2);
    expect(screen.getByTestId("takings-date")).toHaveValue("2026-08-06");
  });
});

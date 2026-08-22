import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import ReportRunPage from "@/app/(tenant)/app/reports/[code]/page";
import RealtimeDashboardPage from "@/app/(tenant)/app/dashboard/realtime/page";
import FbrTaxSummaryPage from "@/app/(tenant)/app/reports/fbr/page";

/**
 * The two reports that were computed and served since phase 12 and drawn nowhere
 * (`ReportCatalog.java:116-128` and `:130-142`), plus the N12 grammar repair on the realtime
 * dashboard.
 */

const BRANCH = "b0000001-0000-4000-8000-000000000001";

/** Next hands `use()` an ALREADY-SETTLED thenable; a bare promise suspends forever under jsdom. */
function settledParams<T>(value: T): Promise<T> {
  const thenable = Promise.resolve(value) as Promise<T> & { status: string; value: T };
  thenable.status = "fulfilled";
  thenable.value = value;
  return thenable;
}

function renderReport(code: string) {
  seedSession({ permissions: ["reporting.report.view"], branchId: BRANCH });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <Suspense fallback={<div>loading route</div>}>
        <ReportRunPage params={settledParams({ code })} />
      </Suspense>
    </Wrapper>,
  );
}

describe("/app/reports/sales-by-hour — the demo's one rota stat, finally drawn", () => {
  afterEach(clearSession);

  it("draws the double peak the report has always been able to compute", async () => {
    renderReport("sales-by-hour");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sales by Hour (Peak Hours)" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("hourly-revenue-chart")).toBeInTheDocument();
    expect(screen.getByText("Two peaks — 13:00 and 19:00.")).toBeInTheDocument();
  });

  it("keeps the grid beneath the picture — the chart is a reading of it, not a replacement", async () => {
    renderReport("sales-by-hour");
    const grid = await screen.findByRole("table", { name: "Sales by Hour (Peak Hours)" });
    // The hour bucket is written the same way in both faces, so a reader comparing them does not
    // have to work out whether `13` and `13:00` are the same row.
    expect(within(grid).getByText("13:00")).toBeInTheDocument();
    expect(within(grid).getByText("Rs 960.00")).toBeInTheDocument();
  });

  it("puts a row count in the subtitle that RECONCILES with the grid's own count", async () => {
    const { container } = renderReport("sales-by-hour");
    await screen.findByTestId("hourly-revenue-chart");

    const header = container.querySelector('[data-slot="page-header"]')!;
    expect(header).toHaveTextContent("11 rows");
    // `DataGrid` counts the array it actually rendered. The two numbers come from one source.
    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("11 rows");
  });
});

describe("/app/reports/sales-by-order-type — the other report nothing drew", () => {
  afterEach(clearSession);

  it("draws the revenue split as ranked bars against the period's own total", async () => {
    renderReport("sales-by-order-type");
    expect(await screen.findByTestId("order-type-mix")).toBeInTheDocument();
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAttribute("aria-valuemax", "598000");
  });
});

describe("a report with no honest visual gets none — silence, not furniture", () => {
  afterEach(clearSession);

  it("renders no chart panel for sales-by-day", async () => {
    renderReport("sales-by-day");
    await screen.findByRole("table", { name: "Sales by Day" });
    expect(screen.queryByTestId("report-visual")).not.toBeInTheDocument();
  });
});

describe("/app/dashboard/realtime — N12, brought onto the shared grammar", () => {
  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {}
    close() {}
  }

  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    seedSession({ permissions: ["reporting.dashboard.view"], branchId: BRANCH });
  });
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it("has exactly one page heading, and it comes from PageHeader", async () => {
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <RealtimeDashboardPage />
      </Wrapper>,
    );
    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Realtime Dashboard");
  });

  it("says whether it is live in WORDS, not only in a hue", async () => {
    const Wrapper = createQueryWrapper();
    const { container } = render(
      <Wrapper>
        <RealtimeDashboardPage />
      </Wrapper>,
    );
    const indicator = await screen.findByTestId("realtime-connection");
    expect(indicator).toHaveTextContent(/Live|Reconnecting/);
    // The two raw palette literals this line used to carry (gate G3) are gone for good.
    expect(container.innerHTML).not.toContain("bg-emerald-500");
    expect(container.innerHTML).not.toContain("bg-amber-500");
  });

  it("renders the snapshot tiles through StatTile", async () => {
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <RealtimeDashboardPage />
      </Wrapper>,
    );
    const revenue = await screen.findByLabelText("Today's Revenue");
    expect(revenue).toHaveAttribute("data-slot", "stat-tile");
    expect(within(revenue).getByText("Rs 5,350.00")).toBeInTheDocument();
  });
});

describe("/app/reports/fbr — a refundable credit, and a failure that is no longer a blank", () => {
  function renderFbr() {
    seedSession({ permissions: ["reporting.report.fbr"], branchId: BRANCH });
    const Wrapper = createQueryWrapper();
    return render(
      <Wrapper>
        <FbrTaxSummaryPage />
      </Wrapper>,
    );
  }

  afterEach(clearSession);

  it("spends the minus sign on WORDS, and renders the magnitude positive", async () => {
    renderFbr();
    // The fixture's input tax exceeds its output tax, so netPayablePaisa is -15,000 paisa.
    const tile = await screen.findByLabelText("Refundable input-tax credit");
    expect(within(tile).getByText("Rs 150.00")).toBeInTheDocument();
    expect(within(tile).queryByText("-Rs 150.00")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Net payable")).not.toBeInTheDocument();
    expect(screen.getByText(/this is a credit, not an amount owed/i)).toBeInTheDocument();
  });

  /**
   * The last live instance of F15 on these surfaces. `FbrTaxSummaryCard` renders `null` for an
   * undefined summary, so a 503 and "not asked yet" were one blank rectangle under an operable
   * date form — which an accountant reads as "this branch owed no tax this month".
   */
  it("announces a reporting-service outage instead of rendering an empty card", async () => {
    server.use(
      http.get("*/api/v1/reporting/reports/fbr-tax-summary", () =>
        HttpResponse.json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "reporting is down", details: [] } },
          { status: 503 },
        ),
      ),
    );
    renderFbr();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/FBR tax summary/i);
    expect(screen.queryByLabelText("Refundable input-tax credit")).not.toBeInTheDocument();
  });

  it("states a missing tax registration rather than leaving a gap in the subtitle", async () => {
    server.use(
      http.get("*/api/v1/reporting/reports/fbr-tax-summary", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH,
            branchName: "Main Branch",
            ntn: null,
            fbrStrn: null,
            periodFrom: "2026-07-01",
            periodTo: "2026-07-18",
            outputTaxPaisa: 10_000,
            taxableSalesPaisa: 100_000,
            inputTaxPaisa: 2_000,
            taxablePurchasesPaisa: 20_000,
            netPayablePaisa: 8_000,
            salesOrderCount: 5,
            purchaseInvoiceCount: 1,
            durationMs: 12,
            dataNotes: ["Branch tax registration unavailable."],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );
    const { container } = renderFbr();

    await screen.findByLabelText("Net payable");
    expect(container.querySelector('[data-slot="page-header"]')).toHaveTextContent(
      "Branch tax registration unavailable — the figures below are unaffected",
    );
    // And the server's own note is surfaced through the shared block, not concatenated away.
    expect(screen.getByTestId("report-data-notes")).toHaveTextContent(
      "Branch tax registration unavailable.",
    );
  });
});

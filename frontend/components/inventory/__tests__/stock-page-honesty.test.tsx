import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import StockPage from "@/app/(tenant)/app/inventory/stock/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * stock-page-honesty.test.tsx — plan 38-07 tasks 3 and 4 end to end, plus the rule that a stat
 * subtitle must RECONCILE with the grid beneath it.
 *
 * <p>The fixture is the live measurement, not an invention: `/app/inventory/stock` renders
 * **Chicken −2987 KG** and **Total stock value: −Rs 2,116,690.70**. Point this file at the code
 * that shipped those as ordinary numbers and the two negative-quantity cases go red.
 */

const BRANCH = "00000000-0000-4000-8000-000000000001";

const stockResponse = {
  branchId: BRANCH,
  totalStockValuePaisa: -211669070,
  items: [
    {
      ingredientId: "10000000-0000-4000-8000-000000000001",
      ingredientName: "Chicken",
      sku: "CHK-01",
      baseUomCode: "KG",
      categoryId: null,
      categoryName: "Meat",
      qtyOnHand: "-2987",
      reorderPoint: "10",
      avgCostPaisa: 70862,
      stockValuePaisa: -211665000,
      lastCountedAt: null,
      belowReorderPoint: true,
      nonPositive: true,
    },
    {
      ingredientId: "10000000-0000-4000-8000-000000000002",
      ingredientName: "Tomatoes",
      sku: "TOM-01",
      baseUomCode: "KG",
      categoryId: null,
      categoryName: "Produce",
      qtyOnHand: "4",
      reorderPoint: "10",
      avgCostPaisa: 12000,
      stockValuePaisa: 48000,
      lastCountedAt: "2026-08-18T08:00:00Z",
      belowReorderPoint: true,
      nonPositive: false,
    },
    {
      ingredientId: "10000000-0000-4000-8000-000000000003",
      ingredientName: "Rice",
      sku: "RIC-01",
      baseUomCode: "KG",
      categoryId: null,
      categoryName: "Dry goods",
      qtyOnHand: "120",
      reorderPoint: "20",
      avgCostPaisa: 22000,
      stockValuePaisa: 2640000,
      lastCountedAt: "2026-08-20T08:00:00Z",
      belowReorderPoint: false,
      nonPositive: false,
    },
  ],
};

function renderPage() {
  seedSession({ permissions: ["inventory.item.manage"] });
  server.use(
    http.get("*/api/v1/inventory/stock", () =>
      HttpResponse.json({ data: stockResponse, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/inventory/categories", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
  );
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StockPage />
    </Wrapper>,
  );
}

describe("stock page honesty", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("theMinus2987KgRowRendersAnExplanationRatherThanAnOrdinaryNumber", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Stock levels" });

    const chickenRow = within(table).getByText("Chicken").closest("tr") as HTMLElement;
    expect(within(chickenRow).getByTestId("negative-on-hand")).toHaveTextContent("-2987 KG");
    expect(within(chickenRow).getByText("below zero")).toBeInTheDocument();
    expect(
      within(chickenRow).getByRole("button", { name: "Why is Chicken on hand below zero?" }),
    ).toBeInTheDocument();
  });

  it("aPositiveRowIsLeftPlainSoTheFlagKeepsItsMeaning", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Stock levels" });

    const riceRow = within(table).getByText("Rice").closest("tr") as HTMLElement;
    expect(within(riceRow).getByText("120 KG")).toBeInTheDocument();
    expect(within(riceRow).queryByTestId("negative-on-hand")).toBeNull();
    expect(within(riceRow).queryByText("below zero")).toBeNull();
  });

  it("theNegativeBranchTotalIsFlaggedAndNotPrintedAsAnOrdinaryValuation", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Stock levels" });

    // −Rs 2,116,690.70, the measured figure, still formatted by MoneyDisplay alone.
    const flagged = screen.getAllByTestId("negative-value");
    expect(flagged.length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Why is total stock value below zero?" }),
    ).toBeInTheDocument();
  });

  it("everyAlertedRowCarriesIconTextAndColourAndTheHealthyRowSaysInStock", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Stock levels" });

    const chickenRow = within(table).getByText("Chicken").closest("tr") as HTMLElement;
    const tomatoRow = within(table).getByText("Tomatoes").closest("tr") as HTMLElement;
    const riceRow = within(table).getByText("Rice").closest("tr") as HTMLElement;

    // Out of stock wins over below-reorder-point when the server sets both flags.
    expect(within(chickenRow).getByTestId("stock-alert-out")).toHaveTextContent("Out of stock");
    expect(within(tomatoRow).getByTestId("stock-alert-low")).toHaveTextContent(
      "Below reorder point",
    );
    expect(within(riceRow).getByTestId("stock-alert-ok")).toHaveTextContent("In stock");
  });

  it("theStatSubtitleReconcilesWithTheGridUnderneathIt", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Stock levels" });

    // Three rows on screen, two of them alerting — the subtitle says exactly that, and both
    // numbers are counted off the same array the grid renders.
    const rowCount = within(table).getAllByRole("row").length - 1; // minus the header row
    expect(rowCount).toBe(3);

    const heading = screen.getByRole("heading", { level: 1, name: "Stock" });
    const header = heading.closest("[data-slot='page-header']") as HTMLElement;
    expect(header).toHaveTextContent("3 ingredients");
    expect(header).toHaveTextContent("2 alerts");
  });
});

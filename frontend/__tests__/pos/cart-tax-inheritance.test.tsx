import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PosTerminal } from "@/components/pos/pos-terminal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

/**
 * F16 — what the cashier actually sees on the cart, in paisa.
 *
 * <h2>The measurement this exists to make impossible again</h2>
 *
 * The 2026-08-12 walkthrough rang a real dine-in check: subtotal Rs 1,657.00, tax Rs 25.60. That
 * is 1.5%. Nothing was broken in the arithmetic — the cart priced every line from the menu item's
 * own {@code taxRatePct} column, and only two of the lines had ever been given one. Every other
 * dish, on a menu of 40, was silently zero-rated. The panel called the figure "Tax (est.)", which
 * made a wrong number look like a cautious one.
 *
 * <h2>Why this test drives the terminal and not `cartTaxPaisa`</h2>
 *
 * Because the defect was never in the arithmetic. `cartTaxPaisa(lines)` was correct for the lines
 * it was handed; the bug was the FIELD the terminal put on those lines. A unit test of the reducer
 * passes against the broken product, which is exactly the failure mode this repo keeps paying for.
 * So this renders the till, taps two real menu tiles, and reads the rendered rupees.
 */

const BRANCH_ID = "b1000001-0000-4000-8000-000000000001";
const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

/**
 * The two dishes and the shape that matters.
 *
 * <p>BOTH carry `taxRatePct: "0"` — the item's own legacy column, empty, which is what 33 of the
 * live menu's 40 rows look like. The rate lives on `effectiveTaxRatePct`, resolved server-side
 * from the CATEGORY's tax class. A terminal that reads the wrong field renders Rs 0.00 here.
 */
const rawItems = [
  {
    id: "a1000001-0000-4000-8000-000000000001",
    categoryId: CATEGORY_ID,
    categoryName: "Mains",
    name: "Chicken Karahi",
    description: null,
    basePricePaisa: 95000,
    taxRatePct: "0",
    taxRateCode: null,
    kdsStation: null,
    active: true,
    taxClassId: null,
    effectiveTaxRatePct: "17.00",
    effectiveTaxRateCode: "SR-STD-17",
    effectiveTaxLabel: "Standard rate",
    effectiveTaxSource: "CATEGORY",
  },
  {
    id: "a1000001-0000-4000-8000-000000000002",
    categoryId: CATEGORY_ID,
    categoryName: "Mains",
    name: "Fresh Lime",
    description: null,
    basePricePaisa: 25000,
    taxRatePct: "0",
    taxRateCode: null,
    kdsStation: null,
    active: true,
    taxClassId: "d1000001-0000-4000-8000-000000000002",
    effectiveTaxRatePct: "0.00",
    effectiveTaxRateCode: "ZR-EXEMPT",
    effectiveTaxLabel: "Zero-rated",
    effectiveTaxSource: "ITEM",
  },
];

const rawCategories = [
  {
    id: CATEGORY_ID,
    name: "Mains",
    description: null,
    sortOrder: 1,
    active: true,
    taxClassId: "d1000001-0000-4000-8000-000000000001",
    taxClassName: "Standard rate",
    taxClassRatePct: "17.00",
  },
];

function mockMenu() {
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({
        data: rawItems,
        meta: { page: { current: "0", next: null, size: 50 }, total: rawItems.length },
        warnings: [],
      }),
    ),
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
  );
}

function renderTerminal() {
  seedSession({ branchId: BRANCH_ID, permissions: ["pos.menu.view", "pos.order.create"] });
  mockMenu();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PosTerminal branchId={BRANCH_ID} />
    </Wrapper>,
  );
}

describe("POS cart — the tax a cashier sees (F16)", () => {
  afterEach(() => clearSession());

  it("taxesALineAtTheRateItsCategoryCarries", async () => {
    renderTerminal();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Chicken Karahi/ }));

    // Rs 950.00 at 17% = Rs 161.50. Computed here from the price and the rate, not read back
    // from the component. Before F16 this rendered Rs 0.00, because the dish's OWN column is 0.
    expect(await screen.findByTestId("cart-tax")).toHaveTextContent("Rs 161.50");
    expect(screen.getByTestId("cart-total")).toHaveTextContent("Rs 1,111.50");
  });

  it("mixesTwoRatesOnOneCheckAndAgreesToThePaisa", async () => {
    renderTerminal();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Chicken Karahi/ }));
    await user.click(await screen.findByRole("button", { name: /Fresh Lime/ }));

    // Karahi 95_000 @ 17% = 16_150; Lime 25_000 @ 0% (its OWN class overrides the category) = 0.
    // Subtotal Rs 1,200.00, tax Rs 161.50, total Rs 1,361.50.
    expect(await screen.findByTestId("cart-tax")).toHaveTextContent("Rs 161.50");
    expect(screen.getByTestId("cart-total")).toHaveTextContent("Rs 1,361.50");
  });

  /**
   * The label, asserted as a user-visible string.
   *
   * <p>"(est.)" was not cosmetic — it was the product telling a cashier that the number beside it
   * might be wrong, which it was. The hedge can only be removed once the figure is the one the
   * server will charge, and this assertion is what keeps somebody from putting it back without
   * re-introducing the doubt it described.
   */
  it("doesNotCallTheTaxAnEstimateAnyMore", async () => {
    renderTerminal();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Chicken Karahi/ }));
    await screen.findByTestId("cart-tax");

    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/est\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimated/)).not.toBeInTheDocument();
  });
});

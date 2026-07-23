import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import StockPage from "@/app/(tenant)/app/inventory/stock/page";
import { StockCountDialog } from "@/components/inventory/StockCountDialog";
import { StockReceiptDialog } from "@/components/inventory/StockReceiptDialog";

// stock-operations.test.tsx — 08.2-17 Task 3: server-decided row emphasis (warning/destructive/
// both-prefers-destructive), the stock empty state's actionable CTA, live count variance, and the
// shared-combobox-not-a-text-field contract — all driven end to end through the real MSW
// inventory handlers (frontend/mocks/inventory.handlers.ts), mirroring category-tree.test.tsx's
// harness (08.2-14).

function renderWithSession(ui: React.ReactElement) {
  seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
  const Wrapper = createQueryWrapper();
  return render(<Wrapper>{ui}</Wrapper>);
}

describe("Stock page — row emphasis reads server flags only (INV-15, T-08.2-173/175)", () => {
  afterEach(() => clearSession());

  it("rowAtOrBelowReorderPointGetsTheWarningWash", async () => {
    renderWithSession(<StockPage />);

    // Chicken: qtyOnHand=4, reorderPoint=10 (belowReorderPoint true, nonPositive false) — the
    // real MSW stock fixture, not a hand-built row.
    const cell = await screen.findByText("Chicken");
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("bg-warning/10");
    expect(row).not.toHaveClass("bg-destructive/10");
    // Colour is never the sole signal — a text-labelled chip is present too.
    expect(within(row as HTMLElement).getByText("Below reorder point")).toBeInTheDocument();
  });

  it("rowAtOrBelowZeroGetsTheDestructiveWash", async () => {
    renderWithSession(<StockPage />);

    // Milk: qtyOnHand=-3, reorderPoint=0 — nonPositive true, belowReorderPoint FALSE (a positive
    // reorder point is required), so this is a genuinely destructive-only row, distinct from
    // Sugar's both-flags case below.
    const cell = await screen.findByText("Milk");
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("bg-destructive/10");
    expect(row).not.toHaveClass("bg-warning/10");
    expect(within(row as HTMLElement).getByText("Out of stock")).toBeInTheDocument();
  });

  it("rowWithBothFlagsPrefersDestructive", async () => {
    renderWithSession(<StockPage />);

    // Sugar: qtyOnHand=-2, reorderPoint=15 — BOTH belowReorderPoint and nonPositive are true;
    // destructive must win the visual wash (tailwind-merge resolves the conflicting bg-* pair).
    const cell = await screen.findByText("Sugar");
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("bg-destructive/10");
    expect(row).not.toHaveClass("bg-warning/10");
    expect(within(row as HTMLElement).getByText("Out of stock")).toBeInTheDocument();
  });

  it("emptyBranchRendersTheStockEmptyStateWithAnAction", async () => {
    server.use(
      http.get("*/api/v1/inventory/stock", () =>
        HttpResponse.json({
          data: {
            branchId: "b0000001-0000-4000-8000-000000000001",
            items: [],
            totalStockValuePaisa: 0,
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    renderWithSession(<StockPage />);

    expect(await screen.findByText("No stock recorded yet")).toBeInTheDocument();
    expect(
      screen.getByText("Record an opening balance to start tracking on-hand quantities for this branch."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record opening balance" })).toBeInTheDocument();
  });
});

describe("StockCountDialog — live variance from the real stock-levels read model (INV-06)", () => {
  afterEach(() => clearSession());

  it("countVarianceUpdatesLiveAsCountedQuantityChanges", async () => {
    renderWithSession(<StockCountDialog trigger={<button type="button">Open count</button>} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open count" }));

    // Chicken's expected qty (dimmed, informational) comes straight from the real GET /stock
    // fixture (4) — never re-fetched or re-derived for the count sheet.
    expect(await screen.findByText("Chicken")).toBeInTheDocument();
    const chickenExpectedCell = screen.getByText("4", { selector: "td" });
    expect(chickenExpectedCell).toHaveClass("text-muted-foreground");

    const countedInput = screen.getByRole("textbox", { name: "Counted quantity for Chicken" });
    await user.type(countedInput, "6");

    // Live variance = counted(6) - expected(4) = +2.
    expect(await screen.findByText("+2")).toBeInTheDocument();
  });

  it("countRowWithLargeVarianceIsEmphasised", async () => {
    renderWithSession(<StockCountDialog trigger={<button type="button">Open count</button>} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open count" }));
    await screen.findByText("Chicken");

    const countedInput = screen.getByRole("textbox", { name: "Counted quantity for Chicken" });
    await user.type(countedInput, "6");
    await screen.findByText("+2");

    const countedRow = countedInput.closest("tr");
    expect(countedRow).not.toBeNull();
    expect(countedRow).toHaveClass("bg-warning/10");

    // A typed-negative counted value takes the destructive wash immediately, even though the
    // backend contract (`@PositiveOrZero`) would refuse it on submit.
    await user.clear(countedInput);
    await user.type(countedInput, "-1");
    expect(countedRow).toHaveClass("bg-destructive/10");
    expect(countedRow).not.toHaveClass("bg-warning/10");
  });
});

describe("StockReceiptDialog — ingredient selection is the shared combobox (T-08.2-174)", () => {
  afterEach(() => clearSession());

  it("ingredientSelectionUsesTheSharedComboboxNotATextField", async () => {
    renderWithSession(<StockReceiptDialog trigger={<button type="button">Open receipt</button>} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open receipt" }));

    // CatalogItemCombobox renders an anchored trigger button (aria-labelled with its
    // placeholder) — not a free-text identifier input.
    expect(
      await screen.findByRole("button", { name: /select an ingredient/i }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ingredient/i, { selector: "input" })).not.toBeInTheDocument();
  });
});

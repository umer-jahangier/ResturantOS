import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
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

// Chicken (MSW fixture): 4 on hand, in Poultry, which sets no cap of its own and inherits Meat &
// Poultry's 5% — so these tests exercise the inherited-cap path, not a hand-set leaf value.
describe("Stock count — variance cap requires an attributed override", () => {
  afterEach(() => clearSession());

  // A REAL uuid branch, unlike the harness default of "branch-1": posting a count runs the request
  // body through `createStockCountInputSchema`, whose `branchId` is `z.string().uuid()`. With the
  // default the parse throws before any HTTP call, so a post could never be observed at all.
  const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

  async function openCountSheet() {
    seedSession({
      branchId: BRANCH_ID,
      permissions: ["inventory.item.view", "inventory.item.manage"],
    });
    const Wrapper = createQueryWrapper();
    render(<Wrapper><StockCountDialog trigger={<button type="button">Open count</button>} /></Wrapper>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open count" }));
    const dialog = await screen.findByRole("dialog");
    await screen.findByLabelText("Counted quantity for Chicken");
    return { user, dialog };
  }

  it("aWithinCapVarianceAsksForNothing", async () => {
    const { user, dialog } = await openCountSheet();

    await user.type(within(dialog).getByLabelText("Counted quantity for Chicken"), "4");

    // Counted exactly what was expected — no variance, so no cap warning and no reason field.
    expect(within(dialog).queryByText(/variance cap/i)).toBeNull();
    expect(
      within(dialog).queryByLabelText("Reason for over-cap variance on Chicken"),
    ).toBeNull();
  });

  it("anOverCapVarianceSurfacesTheCapAndAsksWhy", async () => {
    const { user, dialog } = await openCountSheet();

    // 1 counted against 4 expected is -75%, well past the inherited 5% cap.
    await user.type(within(dialog).getByLabelText("Counted quantity for Chicken"), "1");

    // The cap is NAMED, so the number isn't a mystery, and the reason field appears inline on the
    // offending row rather than as a modal after a failed post.
    expect(within(dialog).getByText(/Over the 5% variance cap/)).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Reason for over-cap variance on Chicken"),
    ).toBeInTheDocument();
    // Colour is never the sole signal — the row carries an icon and the text above.
    expect(within(dialog).getByText("(-75.0%)")).toBeInTheDocument();
  });

  it("postingIsBlockedUntilAReasonIsGivenThenSucceeds", async () => {
    const posted: unknown[] = [];
    server.use(
      http.post("*/api/v1/inventory/counts", async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({
          data: { countId: "9c111111-1111-4111-8111-111111110001", branchId: "b", status: "POSTED", lines: [], totalVarianceCostPaisa: 0 },
        });
      }),
    );

    const { user, dialog } = await openCountSheet();
    await user.type(within(dialog).getByLabelText("Counted quantity for Chicken"), "1");

    await user.click(within(dialog).getByRole("button", { name: "Post count" }));
    // Caught before the round trip — the server enforces the same rule regardless, but there is no
    // reason to make the user wait for a rejection the sheet can already see coming.
    expect(posted).toHaveLength(0);

    await user.type(
      within(dialog).getByLabelText("Reason for over-cap variance on Chicken"),
      "Freezer failure",
    );
    await user.click(within(dialog).getByRole("button", { name: "Post count" }));

    // A count must always be able to record physical reality — the cap makes a large write-off
    // deliberate and attributed, it does not forbid it.
    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0] as { lines: Array<{ overrideReason?: string }> };
    expect(body.lines[0]?.overrideReason).toBe("Freezer failure");
  }, 15000);
});

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

  it("countRowEmphasisDistinguishesRoutineVarianceFromAnOverCapOne", async () => {
    renderWithSession(<StockCountDialog trigger={<button type="button">Open count</button>} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open count" }));
    await screen.findByText("Chicken");

    // Flour: 35 expected, in Dry Goods (3% cap). Counting 36 is +2.9% — a real variance, but one
    // that will post without comment, so it takes the ordinary amber wash.
    const flourInput = screen.getByRole("textbox", { name: "Counted quantity for Flour" });
    await user.type(flourInput, "36");
    await screen.findByText("+1");
    const flourRow = flourInput.closest("tr");
    expect(flourRow).toHaveClass("bg-warning/10");
    expect(flourRow).not.toHaveClass("bg-destructive/10");

    // Chicken: 4 expected, inheriting Meat & Poultry's 5% cap. Counting 6 is +50%, which cannot
    // post without a reason — materially different from Flour's +2.9%, so it reads differently.
    const chickenInput = screen.getByRole("textbox", { name: "Counted quantity for Chicken" });
    await user.type(chickenInput, "6");
    const chickenRow = chickenInput.closest("tr");
    expect(chickenRow).toHaveClass("bg-destructive/10");
    expect(chickenRow).not.toHaveClass("bg-warning/10");

    // A typed-negative counted value takes the destructive wash immediately, even though the
    // backend contract (`@PositiveOrZero`) would refuse it on submit.
    await user.clear(flourInput);
    await user.type(flourInput, "-1");
    expect(flourRow).toHaveClass("bg-destructive/10");
    expect(flourRow).not.toHaveClass("bg-warning/10");
  }, 15000);
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

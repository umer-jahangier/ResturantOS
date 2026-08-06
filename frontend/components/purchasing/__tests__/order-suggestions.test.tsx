import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { toast } from "sonner";
import OrderSuggestionsPage from "@/app/(tenant)/app/purchasing/order-suggestions/page";

// The app mounts <Toaster /> at the layout level, which these component-scoped tests do not — so a
// toast leaves no DOM to query. Spying is how the confirmation can still be asserted.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// order-suggestions.test.tsx — the screen that finally reads `ingredients.par_level`. Reorder
// point already drove low-stock alerts, so the system could say "something is low" and never "buy
// this much"; par level answers the second half and had no reader anywhere until this.

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

function renderPage() {
  seedSession({ branchId: BRANCH_ID, permissions: ["vendor.view", "vendor.po.create"] });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <OrderSuggestionsPage />
    </Wrapper>,
  );
}

describe("Suggested orders", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("everyLineShowsBothWhatIsMissingAndWhatToBuy", async () => {
    renderPage();

    const cell = await screen.findByText("Chicken breast");
    const row = cell.closest("tr") as HTMLElement;

    // 4 kg on hand against a 25 kg par is 21 kg short. The supplier ships in 10 kg increments, so
    // 21 rounds UP to 30 — showing only the order figure hides why it exceeds what's missing, and
    // showing only the shortfall isn't orderable.
    expect(within(row).getByText("21 kg")).toBeInTheDocument();
    expect(within(row).getByLabelText("Order quantity for Chicken breast")).toHaveValue("30");
    expect(within(row).getByText(/reorder at 10 · par 25/)).toBeInTheDocument();
  });

  it("linesAreGroupedUnderTheSupplierTheyWillBeOrderedFrom", async () => {
    renderPage();

    // A purchase order goes to exactly one supplier, so the grouping on screen is the grouping
    // that gets created — the browser never has to re-derive it.
    expect(await screen.findByRole("heading", { name: "Fresh Foods Ltd" })).toBeInTheDocument();
  });

  it("everythingOrderableStartsSelectedBecauseThatIsTheCommonCase", async () => {
    renderPage();

    const checkbox = await screen.findByLabelText("Include Chicken breast");
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("button", { name: "Create draft orders" })).toBeInTheDocument();
  });

  it("deselectingEveryLineHidesTheCreateAction", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Include Chicken breast"));
    await user.click(screen.getByLabelText("Include Tomatoes"));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Create draft orders" })).toBeNull(),
    );
  }, 20000);

  it("theQuantityIsEditableAndTheTotalFollowsIt", async () => {
    renderPage();
    const user = userEvent.setup();

    const qty = await screen.findByLabelText("Order quantity for Chicken breast");
    const row = qty.closest("tr") as HTMLElement;
    // Intl renders PKR as "Rs" and separates it with a non-breaking space, so normalise both
    // rather than hard-coding a formatting detail this test is not about.
    const amount = (value: string) =>
      within(row).getByText(
        (_text, element) =>
          element?.tagName === "SPAN" &&
          (element.textContent ?? "").replace(/ /g, " ").trim() === `Rs ${value}`,
      );

    // 30 kg at Rs 950.00 each.
    expect(amount("28,500.00")).toBeInTheDocument();

    await user.clear(qty);
    await user.type(qty, "40");

    // A suggestion is a starting point, not an instruction — a buyer who knows a promotion is
    // coming can order more, and the estimate has to keep up.
    await waitFor(() => expect(amount("38,000.00")).toBeInTheDocument());
  }, 20000);

  it("theReviewedQuantitiesAreWhatGetSentNotARecomputation", async () => {
    const posted: Array<{ lines: Array<{ vendorItemId: string; qty: string }> }> = [];
    server.use(
      http.post("*/api/v1/purchasing/order-suggestions/drafts", async ({ request }) => {
        posted.push(
          (await request.json()) as { lines: Array<{ vendorItemId: string; qty: string }> },
        );
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }),
    );

    renderPage();
    const user = userEvent.setup();

    const qty = await screen.findByLabelText("Order quantity for Chicken breast");
    await user.clear(qty);
    await user.type(qty, "7");
    await user.click(screen.getByLabelText("Include Tomatoes"));
    await user.click(screen.getByRole("button", { name: "Create draft orders" }));

    // Suggestions recompute on every read — stock moves, prices change — so sending back a "create
    // everything" flag would order whatever was true at click time rather than what was reviewed.
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.lines).toHaveLength(1);
    expect(posted[0]?.lines[0]?.qty).toBe("7");
  }, 25000);

  it("creatingDraftsConfirmsHowManyOrdersWereMade", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByLabelText("Order quantity for Chicken breast");
    await user.click(screen.getByRole("button", { name: "Create draft orders" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("draft purchase order")),
    );
  }, 25000);

  it("nothingToOrderReadsAsCoveredNotAsBroken", async () => {
    server.use(
      http.get("*/api/v1/purchasing/order-suggestions", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH_ID,
            vendorGroups: [],
            unassigned: [],
            blockedCount: 0,
            estimatedTotalPaisa: 0,
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("Nothing needs ordering")).toBeInTheDocument();
  });

  it("anItemThatCannotBeOrderedIsShownWithItsReasonRatherThanHidden", async () => {
    server.use(
      http.get("*/api/v1/purchasing/order-suggestions", () =>
        HttpResponse.json({
          data: {
            branchId: BRANCH_ID,
            vendorGroups: [],
            unassigned: [
              {
                ingredientId: "11111111-1111-4111-8111-111111119999",
                ingredientName: "Saffron",
                sku: "ING-SAF",
                categoryName: "Spices",
                qtyOnHand: "0",
                reorderPoint: "2",
                parLevel: "5",
                stockUom: "g",
                shortfallQty: "5",
                vendorId: null,
                vendorName: null,
                vendorItemId: null,
                vendorSku: null,
                packDescription: null,
                orderUom: null,
                orderQty: null,
                unitPricePaisa: null,
                lineTotalPaisa: null,
                leadTimeDays: null,
                blockedReason:
                  "No supplier set up for this item. Add it to a vendor's catalogue first.",
              },
            ],
            blockedCount: 1,
            estimatedTotalPaisa: 0,
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    renderPage();

    // A list that silently drops what it can't solve reads as "everything else is covered" — the
    // wrong thing for an item at zero on hand to be hiding behind.
    expect(await screen.findByText(/Low, but needs setting up first \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/No supplier set up for this item/)).toBeInTheDocument();
    expect(screen.getByText("Saffron")).toBeInTheDocument();
  });
});

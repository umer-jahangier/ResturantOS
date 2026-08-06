import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { VendorDetailPageContent } from "@/app/(tenant)/app/purchasing/vendors/[id]/page";
import { VendorItemFormDialog } from "@/components/purchasing/VendorItemFormDialog";
import { VendorItemPriceDialog } from "@/components/purchasing/VendorItemPriceDialog";
import { VendorCategoryTags } from "@/components/purchasing/VendorCategoryTags";
import type { VendorItem } from "@/lib/adapters/purchasing.adapter";

// vendor-catalog.test.tsx — 08.2-18 Task 3: append-only pricing (recording a price never
// overwrites the old row), the "no in-place price edit" invariant (T-08.2-182), the category-tag
// filter-only caption (T-08.2-183), the linked-ingredient edit-mode lock (T-08.2-184), and the
// price-delta icon-not-colour-alone rule (T-08.2-185) — all driven through the real MSW purchasing
// handlers (mocks/purchasing.handlers.ts), reusing the CategoryTree test harness pattern (08.2-14).

// The real MSW fixtures (mocks/purchasing.handlers.ts) — hardcoded here rather than exported,
// mirroring category-tree.test.tsx's "the real MSW fixture" comment convention.
const VENDOR_ID = "c0000001-0000-4000-8000-000000000001";
const VENDOR_B_ID = "f0000002-0000-4000-8000-000000000002";
const VENDOR_ITEM_1_SKU = "FF-CHKN-01";

const FIXTURE_VENDOR_ITEM: VendorItem = {
  id: "a1000001-0000-4000-8000-000000000001",
  vendorId: VENDOR_ID,
  ingredientId: "11111111-1111-4111-8111-111111110001",
  vendorSku: VENDOR_ITEM_1_SKU,
  vendorDescription: "Chicken breast, boneless",
  orderUom: "kg",
  packDescription: "10kg case",
  packQty: "10",
  packUom: "kg",
  minOrderQty: "10",
  orderMultiple: "10",
  leadTimeDays: 2,
  preferred: true,
  catchWeight: false,
  archivedAt: null,
  currentUnitPricePaisa: 95_000,
  currentPriceUom: "kg",
  currentPriceEffectiveFrom: "2026-06-01T00:00:00Z",
};

function renderVendorDetailPage(vendorId: string) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <VendorDetailPageContent vendorId={vendorId} />
    </Wrapper>,
  );
}

function renderPriceDialog(vendorItem: VendorItem = FIXTURE_VENDOR_ITEM) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <VendorItemPriceDialog vendorItem={vendorItem} open onOpenChange={() => {}} />
    </Wrapper>,
  );
}

function renderVendorItemFormDialog(vendorItem?: VendorItem) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <VendorItemFormDialog
        vendorId={VENDOR_ID}
        vendorItem={vendorItem}
        open
        onOpenChange={() => {}}
      />
    </Wrapper>,
  );
}

function renderCategoryTags(vendorId: string, editable: boolean) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <VendorCategoryTags vendorId={vendorId} editable={editable} />
    </Wrapper>,
  );
}

describe("Vendor catalog — append-only pricing and no in-place edit (PUR-07, T-08.2-182)", () => {
  afterEach(() => clearSession());

  // Explicit longer timeout: this test drives a full render -> tab-switch -> row-action ->
  // dialog-submit -> refetch round trip through the real MSW handlers, which is slower than the
  // default 5s budget under full-suite parallel contention (an accepted mitigation for that
  // flake class, same as documented elsewhere in this codebase for other multi-step interaction
  // tests) — not a sign the interaction itself is slow in isolation (it completes in ~2-3s alone).
  it("recordingAPriceAppendsToTheHistoryAndDoesNotChangeTheOldRow", async () => {
    seedSession({ permissions: ["vendor.view", "vendor.manage"] });
    renderVendorDetailPage(VENDOR_ID);
    const user = userEvent.setup();

    // Baseline row count on the real Price Changes report before this test writes anything.
    await user.click(await screen.findByRole("tab", { name: "Price Changes" }));
    await screen.findByRole("table");
    const initialDataRowCount = screen.getAllByRole("row").length - 1;

    await user.click(screen.getByRole("tab", { name: "Catalog" }));
    await user.click(
      await screen.findByRole("button", { name: `Actions for ${VENDOR_ITEM_1_SKU}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Record new price" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/never overwritten/i)).toBeInTheDocument();
    // The current price (950.00, VENDOR_ITEM_PRICE_1B) is shown for comparison before this write.
    expect(within(dialog).getByText(/950\.00/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("New price (PKR)"), "999");
    await user.click(within(dialog).getByRole("button", { name: "Record price" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Back on Price Changes: exactly one more row, and the prior rows' amounts are untouched.
    await user.click(screen.getByRole("tab", { name: "Price Changes" }));
    await waitFor(() => {
      expect(screen.getAllByRole("row").length - 1).toBe(initialDataRowCount + 1);
    });

    // The original 900 -> 950 change is still there, unedited (900.00 appears as both the
    // first-ever row's own price and the following row's "previous price" column).
    expect(screen.getAllByText(/900\.00/).length).toBeGreaterThan(0);
    // The new row: previous price 950.00 (the old row, unchanged) and new price 999.00.
    expect(screen.getAllByText(/950\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/999\.00/)).toBeInTheDocument();
  }, 15000);

  it("priceDialogStatesThatTheOldPriceIsKept", () => {
    renderPriceDialog();
    expect(screen.getByText(/never overwritten/i)).toBeInTheDocument();
  });

  it("thereIsNoInPlacePriceEditControl", async () => {
    seedSession({ permissions: ["vendor.view", "vendor.manage"] });
    renderVendorDetailPage(VENDOR_ID);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: `Actions for ${VENDOR_ITEM_1_SKU}` }),
    );

    // The only price action creates a new price; no control implies overwriting an existing one.
    expect(await screen.findByRole("menuitem", { name: "Record new price" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit price/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /update price/i })).not.toBeInTheDocument();
  });

  it("categoryTagsAlwaysRenderTheFilterOnlyCaption", async () => {
    seedSession({ permissions: ["vendor.view", "vendor.manage"] });

    // Populated tag list (VENDOR_ID carries the "Produce" tag in the real MSW fixture).
    const { unmount } = renderCategoryTags(VENDOR_ID, true);
    expect(await screen.findByText(/does not restrict what can be ordered/i)).toBeInTheDocument();
    unmount();

    // Empty tag list (VENDOR_B_ID has none) — the caption must still render (T-08.2-183).
    renderCategoryTags(VENDOR_B_ID, false);
    expect(await screen.findByText(/does not restrict what can be ordered/i)).toBeInTheDocument();
  });

  it("linkedIngredientIsDisabledInEditMode", async () => {
    seedSession({ permissions: ["vendor.view", "vendor.manage"] });
    renderVendorItemFormDialog(FIXTURE_VENDOR_ITEM);

    const trigger = await screen.findByRole("button", {
      name: "Linked ingredient can't be changed here.",
    });
    expect(trigger).toBeDisabled();
    expect(screen.getByText(/isn't supported/i)).toBeInTheDocument();
  });

  it("priceChangeDeltaUsesAnIconNotColourAlone", async () => {
    seedSession({ permissions: ["vendor.view", "vendor.manage"] });
    renderVendorDetailPage(VENDOR_ID);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: "Price Changes" }));

    // The 900 -> 950 change on VENDOR_ITEM_1 is a +5.56% increase (the real MSW fixture).
    const deltaText = await screen.findByText("+5.56%");
    const deltaWrapper = deltaText.closest("span")?.parentElement;
    expect(deltaWrapper?.querySelector("svg")).toBeInTheDocument();
  });
});

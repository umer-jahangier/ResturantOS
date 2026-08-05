import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { PurchaseOrderFormDialog } from "@/components/purchasing/PurchaseOrderFormDialog";

// The jsdom ResizeObserver/scrollIntoView stubs cmdk needs to open a combobox popover were stubbed
// locally here while this was the only such test; they now live in vitest.setup.ts, shared with
// the GL account picker tests.

// po-line-catalog-picker.test.tsx — 08.2-19 Task 2: the PO line's item picker is scoped to the
// selected vendor's catalog (PUR-08), fills unit/price from the picked catalog row while both stay
// editable afterward, only surfaces its "no selection" error on submit (matching the rest of the
// form's validation timing), clears stale lines when the header vendor changes (T-08.2-191), and
// the compact popover empty-state copy — all driven through the real MSW purchasing handlers
// (mocks/purchasing.handlers.ts), reusing the vendor-catalog.test.tsx/ingredient-form-dialog.test.tsx
// render/open-dialog harness pattern.

// The real MSW fixture (mocks/purchasing.handlers.ts) — hardcoded here rather than exported,
// mirroring vendor-catalog.test.tsx's own convention.
const VENDOR_ID = "c0000001-0000-4000-8000-000000000001";
const VENDOR_B_ID = "f0000002-0000-4000-8000-000000000002";
const VENDOR_B_ITEM_ID = "a1000002-0000-4000-8000-000000000001";

function renderDialog() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PurchaseOrderFormDialog trigger={<button type="button">New Purchase Order</button>} />
    </Wrapper>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New Purchase Order" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

async function selectVendor(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, vendorId: string) {
  await user.selectOptions(within(dialog).getByRole("combobox", { name: "Vendor" }), vendorId);
  await waitFor(() => {
    expect(within(dialog).getByRole("button", { name: "Select an item…" })).toBeEnabled();
  });
}

/** A second vendor with its own single catalog item — VENDOR_ID's real fixture has none of these. */
function seedTwoVendorCatalogs() {
  server.use(
    http.get("*/api/v1/purchasing/vendors", () =>
      HttpResponse.json({
        data: [
          {
            id: VENDOR_ID,
            name: "Fresh Foods Ltd",
            contactPerson: null,
            phone: null,
            email: null,
            address: null,
            paymentTerms: "NET30",
            ntn: null,
            strn: null,
            leadTimeDays: null,
            bankAccountLast4: "3456",
            notes: null,
            active: true,
          },
          {
            id: VENDOR_B_ID,
            name: "Value Meats",
            contactPerson: null,
            phone: null,
            email: null,
            address: null,
            paymentTerms: "NET30",
            ntn: null,
            strn: null,
            leadTimeDays: null,
            bankAccountLast4: null,
            notes: null,
            active: true,
          },
        ],
        meta: null,
        warnings: [],
      }),
    ),
    // A literal (non-parameterised) path so this handler only ever intercepts VENDOR_B_ID's own
    // items request — VENDOR_ID's request still falls through to the original, real fixture handler.
    http.get(`*/api/v1/purchasing/vendors/${VENDOR_B_ID}/items`, () =>
      HttpResponse.json({
        data: [
          {
            id: VENDOR_B_ITEM_ID,
            vendorId: VENDOR_B_ID,
            ingredientId: "11111111-1111-4111-8111-111111119999",
            vendorSku: "VM-BEEF-01",
            vendorDescription: "Beef mince, lean",
            orderUom: "kg",
            packDescription: "5kg tray",
            packQty: "5",
            packUom: "kg",
            minOrderQty: "5",
            orderMultiple: "5",
            leadTimeDays: 1,
            preferred: false,
            catchWeight: false,
            archivedAt: null,
            currentUnitPricePaisa: 120_000,
            currentPriceUom: "kg",
            currentPriceEffectiveFrom: "2026-06-01T00:00:00Z",
          },
        ],
        meta: { page: { cursor: "0", nextCursor: null, limit: 20 }, totalCount: 1 },
        warnings: [],
      }),
    ),
  );
}

describe("PurchaseOrderFormDialog — catalog picker (PUR-08, T-08.2-191/192/194)", () => {
  afterEach(() => clearSession());

  it("pickerIsDisabledUntilAVendorIsSelected", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    expect(within(dialog).getByRole("button", { name: "Select a vendor first." })).toBeDisabled();

    await selectVendor(user, dialog, VENDOR_ID);
  });

  it("pickerShowsOnlyTheSelectedVendorsCatalog", async () => {
    seedTwoVendorCatalogs();
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.click(within(dialog).getByRole("button", { name: "Select an item…" }));

    expect(await screen.findByText("Chicken breast, boneless")).toBeInTheDocument();
    expect(screen.queryByText("Beef mince, lean")).not.toBeInTheDocument();
  });

  it("resultRowsShowPackSizeSkuAndPrice", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.click(within(dialog).getByRole("button", { name: "Select an item…" }));

    await screen.findByText("Chicken breast, boneless");
    expect(screen.getByText(/10kg case/)).toBeInTheDocument();
    expect(screen.getByText(/FF-CHKN-01/)).toBeInTheDocument();
    expect(screen.getByText(/950\.00/)).toBeInTheDocument();
  });

  it("selectingAnItemDerivesTheUnitReadOnlyAndFillsThePriceEditably", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.click(within(dialog).getByRole("button", { name: "Select an item…" }));
    await user.click(await screen.findByText("Chicken breast, boneless"));

    // The unit is DERIVED from the chosen catalog item, not asked for: it is the unit the vendor
    // prices in, and the pack size a goods receipt converts by hangs off that same catalog row.
    // A hand-typed unit that disagreed with it changed nothing except what the document claimed,
    // so it is now displayed rather than editable — hence text, not a form value.
    expect(within(dialog).getByLabelText("Unit")).toHaveTextContent("kg");

    // The price stays editable: a negotiated price is a real thing a buyer types.
    const priceInput = within(dialog).getByLabelText("Unit price (PKR)");
    expect(priceInput).toHaveValue("950.00");
    await user.clear(priceInput);
    await user.type(priceInput, "999.99");
    expect(priceInput).toHaveValue("999.99");
  });

  it("submitWithoutASelectionShowsAFieldErrorOnSubmitNotBefore", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.type(within(dialog).getByLabelText("Qty"), "10");
    await user.type(within(dialog).getByLabelText("Unit price (PKR)"), "120.00");

    expect(screen.queryByText("Select a catalog item before adding this line")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create purchase order" }));

    expect(await screen.findByText("Select a catalog item before adding this line")).toBeInTheDocument();
  });

  it("changingTheVendorClearsExistingLines", async () => {
    seedTwoVendorCatalogs();
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.click(within(dialog).getByRole("button", { name: "Select an item…" }));
    await user.click(await screen.findByText("Chicken breast, boneless"));

    expect(within(dialog).getByLabelText("Unit")).toHaveTextContent("kg");
    expect(within(dialog).getByLabelText("Unit price (PKR)")).toHaveValue("950.00");
    // The trigger's visible label (its rendered text, not its static aria-label — see
    // deferred-items.md) reflects the selection.
    expect(within(dialog).getByText("Chicken breast, boneless")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Vendor" }), VENDOR_B_ID);

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Unit")).toHaveValue("");
    });
    expect(within(dialog).getByLabelText("Unit price (PKR)")).toHaveValue("");
    expect(within(dialog).queryByText("Chicken breast, boneless")).not.toBeInTheDocument();
  });

  it("zeroMatchesRendersTheCompactEmptyCopy", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await selectVendor(user, dialog, VENDOR_ID);
    await user.click(within(dialog).getByRole("button", { name: "Select an item…" }));

    const searchInput = await screen.findByPlaceholderText("Search…");
    await user.type(searchInput, "zzzznomatch");

    expect(await screen.findByText("No catalog items match “zzzznomatch”")).toBeInTheDocument();
    expect(
      screen.getByText("Try a different search, or add this item to the vendor's catalog first."),
    ).toBeInTheDocument();
  });

  it("noFreeTextIdentifierInputExistsInTheLineRow", async () => {
    seedSession();
    renderDialog();
    const { dialog } = await openDialog();

    expect(within(dialog).queryByPlaceholderText("uuid")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/catalog item id/i)).not.toBeInTheDocument();

    const itemTrigger = within(dialog).getByRole("button", { name: "Select a vendor first." });
    expect(itemTrigger.tagName).toBe("BUTTON");
  });
});

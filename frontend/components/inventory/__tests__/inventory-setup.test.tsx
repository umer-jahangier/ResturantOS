import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { toast } from "sonner";
import InventorySetupPage from "@/app/(tenant)/app/inventory/setup/page";

// The app renders <Toaster /> at the layout level, which these component-scoped tests do not
// mount — so a toast leaves no DOM to query. Spying on the module is how the server's exact
// refusal sentence can still be asserted as reaching the user.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// inventory-setup.test.tsx — the two master-data lists that had no screen until now: units of
// measure (POST /api/v1/inventory/uom existed since 08.2-01 with no caller at all) and storage
// locations (free text on the ingredient form until V10). Driven end to end through the real MSW
// handlers, mirroring category-tree.test.tsx's harness.

function renderPage() {
  seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
  const Wrapper = createQueryWrapper();
  return render(<Wrapper><InventorySetupPage /></Wrapper>);
}

describe("Inventory setup — units of measure", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("unitsAreGroupedByMeasureTypeAndExplainTheirConversion", async () => {
    renderPage();

    // Grouping is the point: a flat list of 14 units gives no clue that grams and kilograms are
    // interchangeable while "each" is not.
    expect(await screen.findByRole("heading", { name: "Weight" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Count" })).toBeInTheDocument();

    // A derived unit states its factor in words; a base unit says it IS the anchor, because
    // "1 kg = 1 kg" is noise.
    expect(screen.getByText("1 g = 0.001 kg")).toBeInTheDocument();
    expect(screen.getAllByText("Base unit").length).toBeGreaterThan(0);
  });

  it("aHouseUnitCanBeAddedAndBecomesAvailableImmediately", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Weight" });

    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Code"), "CASE");
    await user.type(within(dialog).getByLabelText("Name"), "Case");
    await user.selectOptions(within(dialog).getByLabelText("Measure type"), "COUNT");
    await user.selectOptions(within(dialog).getByLabelText("Measured in"), "each");
    const factor = within(dialog).getByLabelText("How many, per unit");
    await user.clear(factor);
    await user.type(factor, "24");

    await user.click(within(dialog).getByRole("button", { name: "Add unit" }));

    await waitFor(() => expect(screen.getByText("1 CASE = 24 each")).toBeInTheDocument());
  }, 20000);

  it("aBaseUnitsFactorIsFixedAtOneRatherThanLeftToBeRejected", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Weight" });

    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const dialog = await screen.findByRole("dialog");

    // "Measured in" defaults to nothing, which means this unit IS its family's base — and a base
    // unit's factor is 1 by definition. Leaving it editable would invite a save the server refuses
    // with UOM_CONVERSION_INVALID.
    const factor = within(dialog).getByLabelText("How many, per unit");
    expect(factor).toBeDisabled();
    expect(factor).toHaveValue("1");
    expect(
      within(dialog).getByText("A base unit is what its family is measured in, so this is always 1."),
    ).toBeInTheDocument();
  });

  it("aDuplicateCodeIsRefusedWithTheServersMessage", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Weight" });

    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const dialog = await screen.findByRole("dialog");

    // "kg" already exists. Matching is case-insensitive, mirroring uq_uom_tenant_code_ci — two
    // casings of one unit are one unit.
    await user.type(within(dialog).getByLabelText("Code"), "KG");
    await user.type(within(dialog).getByLabelText("Name"), "Kilo");
    await user.selectOptions(within(dialog).getByLabelText("Measured in"), "kg");
    await user.click(within(dialog).getByRole("button", { name: "Add unit" }));

    // The server names the unit the code already belongs to, which is the actionable fact — and
    // is what a raw uq_uom_tenant_code_ci constraint violation (a 500) could never have said.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The unit code "kg" is already used by "Kilogram".'),
    );
    // The dialog stays open so the code can be corrected in place.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  }, 20000);
});

describe("Inventory setup — storage locations", () => {
  afterEach(() => clearSession());

  it("locationsListWithTheirLiveItemCount", async () => {
    renderPage();

    const cell = await screen.findByText("Walk-in Cooler");
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    // Chicken and Milk are both filed in the walk-in by the MSW fixture — the count is derived
    // from the ingredients, not stored, so it is the same number the archive gate checks.
    expect(within(row as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("archivingAnOccupiedLocationIsRefusedInlineNotInAToast", async () => {
    renderPage();
    const user = userEvent.setup();

    const cell = await screen.findByText("Walk-in Cooler");
    const row = cell.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive location" }));

    // The refusal names how many items are in the way — precisely the fact the user needs, and
    // precisely what a toast would let them miss. The dialog stays open.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /Can't archive "Walk-in Cooler" — 2 items are still stored there\. Move them first\./,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  }, 20000);

  it("anEmptyLocationArchivesCleanly", async () => {
    server.use(
      http.get("*/api/v1/inventory/storage-locations", () =>
        HttpResponse.json({
          data: [
            {
              id: "81111111-1111-4111-8111-111111110009",
              name: "Old Cupboard",
              description: null,
              sortOrder: 0,
              ingredientCount: 0,
              archivedAt: null,
            },
          ],
          meta: null,
          warnings: [],
        }),
      ),
      http.post("*/api/v1/inventory/storage-locations/:id/archive", () =>
        HttpResponse.json({
          data: {
            id: "81111111-1111-4111-8111-111111110009",
            name: "Old Cupboard",
            description: null,
            sortOrder: 0,
            ingredientCount: 0,
            archivedAt: "2026-07-27T00:00:00Z",
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    renderPage();
    const user = userEvent.setup();

    const cell = await screen.findByText("Old Cupboard");
    const row = cell.closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive location" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 20000);
});

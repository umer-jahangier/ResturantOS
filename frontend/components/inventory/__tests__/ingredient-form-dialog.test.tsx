import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { IngredientFormDialog } from "@/components/inventory/IngredientFormDialog";
import type { Ingredient } from "@/lib/adapters/inventory.adapter";

// ingredient-form-dialog.test.tsx — 08.2-15 Task 3: the required-primary-category gate, the
// server-computed measure-type lock (both directions), the conversions useFieldArray, the
// allergen pill toggles (never checkboxes) and edit-mode prefill across every grouped section.
// Reuses the category-tree.test.tsx harness (render helper + QueryClientProvider + MSW wiring)
// rather than building a second one.

// Poultry — the real MSW category fixture (mocks/inventory.handlers.ts) — used so the "Primary
// category" select has a genuine matching <option> to assert against once useCategories resolves.
const CAT_POULTRY = "71111111-1111-4111-8111-111111110002";
// The real MSW storage-location fixture, for the same reason: the select needs a matching
// <option> to hold this value once useStorageLocations resolves.
const LOC_WALK_IN = "81111111-1111-4111-8111-111111110001";

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "31111111-1111-4111-8111-111111110099",
    name: "Test Ingredient",
    sku: "ING-TEST",
    baseUomCode: "kg",
    categoryId: CAT_POULTRY,
    categoryName: "Poultry",
    categoryPath: "Meat & Poultry / Poultry",
    shortName: null,
    description: null,
    itemType: "PURCHASED",
    producedByRecipeId: null,
    measureType: "WEIGHT",
    measureTypeLocked: false,
    recipeUomCode: null,
    defaultYieldPct: null,
    storageLocationId: LOC_WALK_IN,
    storageLocation: "Walk-in Cooler",
    shelfLifeDays: null,
    perishable: false,
    reorderPoint: "10",
    parLevel: "25",
    conversions: [],
    allergenCodes: ["GLUTEN"],
    archivedAt: null,
    active: true,
    ...overrides,
  };
}

function renderDialog(ingredient?: Ingredient) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <IngredientFormDialog
        ingredient={ingredient}
        trigger={<button type="button">Open ingredient form</button>}
      />
    </Wrapper>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open ingredient form" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

describe("IngredientFormDialog (INV-01/INV-14)", () => {
  afterEach(() => clearSession());

  it(
    "submitIsBlockedWithoutAPrimaryCategory",
    async () => {
      seedSession();
      renderDialog();
      const { user, dialog } = await openDialog();

      await user.type(within(dialog).getByLabelText("Name"), "Unassigned Item");

      // The form opens on COUNT, so reaching a weight unit means switching measure type first —
      // the unit selects are scoped to the selected dimension.
      await user.selectOptions(within(dialog).getByLabelText("Measure type"), "WEIGHT");

      const stockUnitSelect = within(dialog).getByLabelText("Stock unit");
      await waitFor(() => {
        expect(within(stockUnitSelect).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
      });
      await user.selectOptions(stockUnitSelect, "kg");

      // Primary category is left unselected.
      await user.click(within(dialog).getByRole("button", { name: "Add ingredient" }));

      expect(await within(dialog).findByText("A category is required")).toBeInTheDocument();
      // No successful create happened — the dialog is still open (never closed by onSuccess).
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
    15000,
  );

  it("measureTypeIsDisabledWhenTheServerReportsItLocked", async () => {
    seedSession();
    renderDialog(makeIngredient({ measureTypeLocked: true }));
    const { dialog } = await openDialog();

    const measureTypeSelect = within(dialog).getByLabelText("Measure type");
    expect(measureTypeSelect).toBeDisabled();
    expect(measureTypeSelect.getAttribute("title")).toMatch(/Locked/);

    const stockUnitSelect = within(dialog).getByLabelText("Stock unit");
    expect(stockUnitSelect).toBeDisabled();
    expect(stockUnitSelect.getAttribute("title")).toMatch(/Locked/);
  });

  it("measureTypeIsEnabledWhenNotLocked", async () => {
    seedSession();
    renderDialog(makeIngredient({ measureTypeLocked: false }));
    const { dialog } = await openDialog();

    expect(within(dialog).getByLabelText("Measure type")).not.toBeDisabled();
    expect(within(dialog).getByLabelText("Stock unit")).not.toBeDisabled();
  });

  it("conversionRowsCanBeAddedAndRemoved", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    expect(within(dialog).queryAllByRole("button", { name: "Remove" })).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Add conversion" }));
    await user.click(within(dialog).getByRole("button", { name: "Add conversion" }));
    expect(within(dialog).getAllByRole("button", { name: "Remove" })).toHaveLength(2);

    const removeButtons = within(dialog).getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[0]!);
    expect(within(dialog).getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("stockUnitOptionsAreScopedToTheSelectedMeasureType", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    const stockUnitSelect = within(dialog).getByLabelText("Stock unit");

    // Opens on COUNT: only the COUNT unit is offered, never the weight units. This is the pairing
    // the form used to allow — every unit in the tenant showed regardless of measure type.
    await waitFor(() => {
      expect(within(stockUnitSelect).getByRole("option", { name: "each · Each" })).toBeInTheDocument();
    });
    expect(within(stockUnitSelect).queryByRole("option", { name: "kg · Kilogram" })).toBeNull();
    expect(within(stockUnitSelect).queryByRole("option", { name: "g · Gram" })).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText("Measure type"), "WEIGHT");

    expect(within(stockUnitSelect).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
    expect(within(stockUnitSelect).getByRole("option", { name: "g · Gram" })).toBeInTheDocument();
    expect(within(stockUnitSelect).queryByRole("option", { name: "each · Each" })).toBeNull();
  });

  it("changingMeasureTypeClearsAUnitThatIsNoLongerOffered", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await user.selectOptions(within(dialog).getByLabelText("Measure type"), "WEIGHT");
    const stockUnitSelect = within(dialog).getByLabelText("Stock unit");
    await waitFor(() => {
      expect(within(stockUnitSelect).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
    });
    await user.selectOptions(stockUnitSelect, "kg");
    expect(stockUnitSelect).toHaveValue("kg");

    // Switching dimension must not leave "kg" selected behind a select that no longer lists it —
    // it would be invisible in the UI but still submitted, and the server would reject it 422.
    await user.selectOptions(within(dialog).getByLabelText("Measure type"), "COUNT");
    expect(stockUnitSelect).toHaveValue("");
  });

  it("conversionUnitsStayUnfilteredSoTheyCanCrossMeasureTypes", async () => {
    seedSession();
    renderDialog();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Add conversion" }));

    // "1 each = 0.18 kg" is the entire point of per-ingredient conversions, so unlike the stock
    // and recipe unit selects these list every unit regardless of the selected measure type.
    const fromSelect = within(dialog).getByLabelText("From");
    await waitFor(() => {
      expect(within(fromSelect).getByRole("option", { name: "each · Each" })).toBeInTheDocument();
    });
    expect(within(fromSelect).getByRole("option", { name: "kg · Kilogram" })).toBeInTheDocument();
  });

  it("allergensAreTogglePillsNotCheckboxes", async () => {
    seedSession();
    renderDialog();
    const { dialog } = await openDialog();

    const glutenPill = within(dialog).getByRole("button", { name: "Gluten" });
    expect(glutenPill).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it(
    "editModePrefillsEveryGroupedSection",
    async () => {
      seedSession();
      const ingredient = makeIngredient();
      renderDialog(ingredient);
      const { dialog } = await openDialog();

      expect(within(dialog).getByLabelText("Name")).toHaveValue(ingredient.name);
      await waitFor(() => {
        expect(within(dialog).getByLabelText("Primary category *")).toHaveValue(ingredient.categoryId);
      });
      expect(within(dialog).getByLabelText("Par level")).toHaveValue(ingredient.parLevel);
      // A select now, not a text input (V10) — it holds the location's ID and renders its name.
      await waitFor(() => {
        expect(within(dialog).getByLabelText("Storage location")).toHaveValue(LOC_WALK_IN);
      });
      expect(within(dialog).getByRole("button", { name: "Gluten" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
    15000,
  );
});

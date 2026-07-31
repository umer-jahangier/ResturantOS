import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { IngredientFormDialog } from "@/components/inventory/IngredientFormDialog";
import { RecipeFormDialog } from "@/components/inventory/RecipeFormDialog";

// prep-items-and-recipe-defaults.test.tsx — two fields that existed on the wire and meant nothing
// in practice: `producedByRecipeId` (making PREPARED/BOTH a dead option on the item-type select)
// and `defaultYieldPct` (recorded per ingredient, then ignored by every recipe line).

function renderIngredientForm() {
  seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <IngredientFormDialog trigger={<button type="button">Open ingredient form</button>} />
    </Wrapper>,
  );
  return userEvent.setup();
}

describe("Ingredient form — a prepared item can name the recipe that produces it", () => {
  afterEach(() => clearSession());

  it("theRecipePickerIsHiddenForAPurchasedItem", async () => {
    const user = renderIngredientForm();
    await user.click(screen.getByRole("button", { name: "Open ingredient form" }));
    const dialog = await screen.findByRole("dialog");

    // PURCHASED is the default. A purchased item is not produced by anything — that is what makes
    // it purchased — and the server refuses the pair outright.
    expect(within(dialog).getByLabelText("Item type")).toHaveValue("PURCHASED");
    expect(within(dialog).queryByLabelText("Produced by recipe")).toBeNull();
  });

  it("switchingToPreparedOffersTheTenantsCurrentRecipes", async () => {
    const user = renderIngredientForm();
    await user.click(screen.getByRole("button", { name: "Open ingredient form" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Item type"), "PREPARED");

    const picker = await within(dialog).findByLabelText("Produced by recipe");
    // Options read as the menu item a chef recognises, not as a bare recipe UUID.
    await waitFor(() =>
      expect(within(picker).getByRole("option", { name: /Zinger Burger/ })).toBeInTheDocument(),
    );
    // Optional, and explicitly so: the recipe references the item it produces, so the item has to
    // be creatable before the recipe exists.
    expect(within(picker).getByRole("option", { name: "Not linked yet" })).toBeInTheDocument();
  }, 20000);

  it("switchingBackToPurchasedClearsTheRecipeRatherThanHidingIt", async () => {
    const posted: Array<{ producedByRecipeId?: string; itemType?: string }> = [];
    server.use(
      http.post("*/api/v1/inventory/ingredients", async ({ request }) => {
        posted.push((await request.json()) as { producedByRecipeId?: string; itemType?: string });
        return HttpResponse.json({ data: null, meta: null, warnings: [] }, { status: 500 });
      }),
    );

    const user = renderIngredientForm();
    await user.click(screen.getByRole("button", { name: "Open ingredient form" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Item type"), "PREPARED");
    const picker = await within(dialog).findByLabelText("Produced by recipe");
    await waitFor(() =>
      expect(within(picker).getByRole("option", { name: /Zinger Burger/ })).toBeInTheDocument(),
    );
    await user.selectOptions(picker, within(picker).getByRole("option", { name: /Zinger Burger/ }));

    // Flip back. A stale id the user can no longer see but that would still be submitted is
    // exactly the mismatch the server answers with 422 ITEM_TYPE_RECIPE_NOT_ALLOWED.
    await user.selectOptions(within(dialog).getByLabelText("Item type"), "PURCHASED");
    expect(within(dialog).queryByLabelText("Produced by recipe")).toBeNull();

    await user.type(within(dialog).getByLabelText("Name"), "Rice");
    await user.type(within(dialog).getByLabelText("SKU"), "ING-RICE");
    await user.selectOptions(within(dialog).getByLabelText("Primary category *"), "Poultry");
    await user.selectOptions(within(dialog).getByLabelText("Measure type"), "COUNT");
    await user.selectOptions(within(dialog).getByLabelText("Stock unit"), "each");
    await user.type(within(dialog).getByLabelText("Reorder point"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Add ingredient" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.itemType).toBe("PURCHASED");
    expect(posted[0]?.producedByRecipeId).toBeUndefined();
  }, 25000);
});

describe("Recipe form — a line inherits its ingredient's unit and trim yield", () => {
  afterEach(() => clearSession());

  function renderRecipeForm() {
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <RecipeFormDialog trigger={<button type="button">Open recipe form</button>} />
      </Wrapper>,
    );
    return userEvent.setup();
  }

  it("choosingAnIngredientPrefillsItsUnitAndDefaultYield", async () => {
    const user = renderRecipeForm();
    await user.click(screen.getByRole("button", { name: "Open recipe form" }));
    const dialog = await screen.findByRole("dialog");

    const ingredientSelect = within(dialog).getByLabelText("Ingredient");
    await waitFor(() =>
      expect(within(ingredientSelect).getByRole("option", { name: "Chicken" })).toBeInTheDocument(),
    );
    await user.selectOptions(ingredientSelect, "Chicken");

    // Chicken's recipe unit is kg and its default yield is 95% (MSW fixture). Both were recorded
    // per ingredient and read by nothing — every line silently defaulted to 100%, costing plates
    // as though trim did not exist.
    expect(within(dialog).getByLabelText("Unit")).toHaveValue("kg");
    expect(within(dialog).getByLabelText("Yield %")).toHaveValue("95");
  }, 20000);

  it("theUnitListIsScopedToTheIngredientsOwnMeasureType", async () => {
    const user = renderRecipeForm();
    await user.click(screen.getByRole("button", { name: "Open recipe form" }));
    const dialog = await screen.findByRole("dialog");

    const ingredientSelect = within(dialog).getByLabelText("Ingredient");
    await waitFor(() =>
      expect(within(ingredientSelect).getByRole("option", { name: "Chicken" })).toBeInTheDocument(),
    );
    await user.selectOptions(ingredientSelect, "Chicken");

    // Chicken is measured by WEIGHT, so "each" must not be offerable. The server refuses that pair
    // on save and the cost preview silently excludes such a line, so offering it here could only
    // ever produce a rejection or a quietly un-costed recipe.
    const unitSelect = within(dialog).getByLabelText("Unit");
    expect(within(unitSelect).getByRole("option", { name: /^kg/ })).toBeInTheDocument();
    expect(within(unitSelect).queryByRole("option", { name: /^each/ })).toBeNull();
  }, 20000);

  it("thePrefilledYieldIsADefaultNotALock", async () => {
    const user = renderRecipeForm();
    await user.click(screen.getByRole("button", { name: "Open recipe form" }));
    const dialog = await screen.findByRole("dialog");

    const ingredientSelect = within(dialog).getByLabelText("Ingredient");
    await waitFor(() =>
      expect(within(ingredientSelect).getByRole("option", { name: "Chicken" })).toBeInTheDocument(),
    );
    await user.selectOptions(ingredientSelect, "Chicken");

    const yieldInput = within(dialog).getByLabelText("Yield %");
    await user.clear(yieldInput);
    await user.type(yieldInput, "90");
    expect(yieldInput).toHaveValue("90");
  }, 20000);
});

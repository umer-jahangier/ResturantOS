import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { toast } from "sonner";
import { RecipeFormDialog } from "@/components/inventory/RecipeFormDialog";

// recipe-quick-create-menu-item.test.tsx — the whole reason for this feature: creating a menu
// item was only ever possible outside this dialog (nowhere, in fact, until the Menu Items page
// existed), so starting a recipe for a brand-new dish meant leaving Recipes, going somewhere
// else to create the item, and coming back. This is the inline "+ Create new menu item" shortcut,
// including the part that makes it honest rather than racy: the item is created in pos-service,
// but RecipeService.create validates against inventory-service's own SYNCED copy
// (menu_item_catalog), which only catches up after a RabbitMQ event — so the dialog must wait
// for that, not assume it.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CAT_MAINS = "c1000001-0000-4000-8000-000000000001";

function mockMenuCategories() {
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({
        data: [{ id: CAT_MAINS, name: "Mains", description: null, sortOrder: 1, active: true }],
        meta: null,
        warnings: [],
      }),
    ),
  );
}

function renderRecipeForm() {
  seedSession({ permissions: ["inventory.item.view", "inventory.item.manage", "pos.menu.manage"] });
  mockMenuCategories();
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <RecipeFormDialog trigger={<button type="button">Open recipe form</button>} />
    </Wrapper>,
  );
  return userEvent.setup();
}

async function openMenuItemQuickCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open recipe form" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "+ Create new menu item" }));
  return dialog;
}

describe("Recipe form — inline quick-create for a menu item that doesn't exist yet", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("creatingNewCollapsesThePickerIntoAThreeFieldForm", async () => {
    const user = renderRecipeForm();
    const dialog = await openMenuItemQuickCreate(user);

    // The combobox trigger (and its placeholder text) is gone, replaced by the mini-form.
    expect(within(dialog).queryByText("Select a menu item…")).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Menu item category")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Price (Rs)" })).toBeInTheDocument();
  });

  it("cancelReturnsToTheOrdinaryPickerWithoutPosting", async () => {
    let posted = false;
    server.use(
      http.post("*/api/v1/pos/menu/items", () => {
        posted = true;
        return HttpResponse.json({ data: {}, meta: null, warnings: [] });
      }),
    );
    const user = renderRecipeForm();
    const dialog = await openMenuItemQuickCreate(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel new item" }));

    expect(within(dialog).getByRole("button", { name: "+ Create new menu item" })).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it(
    "afterCreatingTheSubmitButtonStaysDisabledUntilInventorysCopyCatchesUpThenAutoSelects",
    async () => {
      let syncedYet = false;
      const NEW_ITEM_ID = "a1000001-0000-4000-8000-000000000099";

      server.use(
        http.post("*/api/v1/pos/menu/items", async ({ request }) => {
          const body = (await request.json()) as { name: string; basePricePaisa: number; categoryId: string };
          expect(body).toEqual({ categoryId: CAT_MAINS, name: "Nihari", basePricePaisa: 55000 });
          // The create response itself is NOT what the picker trusts — it starts polling
          // inventory-service's own copy instead. Flip the flag AFTER a short delay so the
          // dialog genuinely has to wait rather than happening to already be synced.
          setTimeout(() => {
            syncedYet = true;
          }, 50);
          return HttpResponse.json({
            data: {
              id: NEW_ITEM_ID,
              categoryId: CAT_MAINS,
              categoryName: "Mains",
              name: "Nihari",
              description: null,
              basePricePaisa: 55000,
              taxRatePct: "0",
              kdsStation: null,
              active: true,
            },
            meta: null,
            warnings: [],
          });
        }),
        http.get("*/api/v1/inventory/menu-items", () =>
          HttpResponse.json({
            data: syncedYet
              ? [{ menuItemId: NEW_ITEM_ID, name: "Nihari", categoryName: "Mains", active: true, basePricePaisa: 55000 }]
              : [],
            meta: null,
            warnings: [],
          }),
        ),
      );

      const user = renderRecipeForm();
      const dialog = await openMenuItemQuickCreate(user);

      await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Nihari");
      await user.selectOptions(within(dialog).getByLabelText("Menu item category"), CAT_MAINS);
      await user.type(within(dialog).getByRole("textbox", { name: "Price (Rs)" }), "550");
      await user.click(within(dialog).getByRole("button", { name: "Add item" }));

      // Setting-up banner replaces the picker; the recipe cannot be submitted while it's showing
      // — submitting now would 404 against inventory's not-yet-updated copy.
      expect(await within(dialog).findByText(/Setting up "Nihari"/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Create recipe version" })).toBeDisabled();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("Added Nihari"),
      ));

      // Once inventory's copy catches up (syncedYet flips), the banner clears, the item is
      // selected, and the form is submittable again — all without the user doing anything.
      await waitFor(
        () => expect(within(dialog).queryByText(/Setting up "Nihari"/)).toBeNull(),
        { timeout: 10000 },
      );
      expect(within(dialog).getByRole("button", { name: "Create recipe version" })).not.toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Nihari" })).toBeInTheDocument();
    },
    15000,
  );

  it("withNoMenuCategoriesYetThePointsAtTheMenuItemsPageInsteadOfOfferingADeadEndForm", async () => {
    server.use(
      http.get("*/api/v1/pos/menu/categories", () =>
        HttpResponse.json({ data: [], meta: null, warnings: [] }),
      ),
    );
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage", "pos.menu.manage"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <RecipeFormDialog trigger={<button type="button">Open recipe form</button>} />
      </Wrapper>,
    );
    const user = userEvent.setup();
    const dialog = await openMenuItemQuickCreate(user);

    expect(
      await within(dialog).findByText(/No menu categories yet — add one on the Menu Items page first/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Add item" })).toBeNull();
  });
});

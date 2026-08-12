import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import MenuItemsPage from "@/app/(tenant)/app/menu/items/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * S0-03 — "Editing a menu item's description silently erases its tax code".
 *
 * The wire schema always carried `taxRatePct`/`taxRateCode`; the layer-3 domain model did not,
 * so the edit dialog could not round-trip the classification it was about to overwrite. The PUT
 * went out as `{categoryId,name,description,basePricePaisa,imageFileId}` and pos-service's
 * `updateItem` — where null means REMOVE, not "unchanged" — wiped `SR-STD-17` to null.
 *
 * These assertions are on the BODY PUT ON THE WIRE, not on a mutation argument, because the wire
 * is the seam that broke. The last test is the other half of the contract: removal on purpose
 * must still work, or the fix has traded a silent wipe for an unremovable field.
 */

const CAT_STARTERS = "c1000001-0000-4000-8000-000000000001";
const ITEM_ID = "a1000001-0000-4000-8000-000000000001";

const rawCategoriesAdmin = [
  { id: CAT_STARTERS, name: "Starters", description: null, sortOrder: 1, active: true },
];

// A real fiscal classification, exactly as the register seeded it: 17% standard rate, SR-STD-17.
const taxedItem = {
  id: ITEM_ID,
  categoryId: CAT_STARTERS,
  categoryName: "Starters",
  name: "Seekh Kebab",
  description: "Seekh Kebab — Floating Terrace",
  basePricePaisa: 45000,
  taxRatePct: "17.00",
  taxRateCode: "SR-STD-17",
  kdsStation: null,
  active: true,
  imageFileId: null,
  imageUrl: null,
};

function mockEndpoints(onPut: (body: unknown) => void) {
  server.use(
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: rawCategoriesAdmin, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategoriesAdmin, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items/admin", () =>
      HttpResponse.json({ data: [taxedItem], meta: null, warnings: [] }),
    ),
    http.put(`*/api/v1/pos/menu/items/${ITEM_ID}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      onPut(body);
      // Echo the request back the way a REPLACE endpoint does, so the response reflects what
      // was actually asked for rather than laundering an omission into a healthy-looking row.
      return HttpResponse.json({
        data: {
          ...taxedItem,
          ...body,
          taxRatePct: body.taxRatePct ?? null,
          taxRateCode: body.taxRateCode ?? null,
        },
        meta: null,
        warnings: [],
      });
    }),
  );
}

async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Seekh Kebab");
  await user.click(screen.getByRole("button", { name: "Actions for Seekh Kebab" }));
  await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  return screen.findByRole("dialog");
}

function renderPage(onPut: (body: unknown) => void) {
  seedSession({ permissions: ["pos.menu.manage"] });
  mockEndpoints(onPut);
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <MenuItemsPage />
    </Wrapper>,
  );
}

describe("Menu item edit — tax classification round-trip (S0-03)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("editingOnlyTheDescriptionKeepsTheTaxCodeAndRateOnTheWire", async () => {
    let putBody: Record<string, unknown> | null = null;
    renderPage((b) => {
      putBody = b as Record<string, unknown>;
    });
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    const description = within(dialog).getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Seekh Kebab - typo fixed");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toEqual({
      categoryId: CAT_STARTERS,
      name: "Seekh Kebab",
      description: "Seekh Kebab - typo fixed",
      basePricePaisa: 45000,
      taxRatePct: 17,
      taxRateCode: "SR-STD-17",
      imageFileId: null,
    });
  });

  it("theEditDialogShowsTheItemsExistingTaxClassification", async () => {
    renderPage(() => {});
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    expect(within(dialog).getByRole("textbox", { name: "Tax rate (%)" })).toHaveValue("17");
    expect(within(dialog).getByRole("textbox", { name: "Tax code" })).toHaveValue("SR-STD-17");
  });

  it("clearingTheTaxCodeFieldStillRemovesItOnPurpose", async () => {
    let putBody: Record<string, unknown> | null = null;
    renderPage((b) => {
      putBody = b as Record<string, unknown>;
    });
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    await user.clear(within(dialog).getByRole("textbox", { name: "Tax code" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(putBody).not.toBeNull());
    // null, not omitted: pos-service reads an ABSENT key the same way it reads null, so a
    // deliberate removal has to be expressible as a value on the wire.
    expect(putBody).toMatchObject({ taxRateCode: null, taxRatePct: 17 });
    expect(putBody).toHaveProperty("taxRateCode");
  });
});

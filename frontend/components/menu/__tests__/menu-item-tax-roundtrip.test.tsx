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
 *
 * <h2>F16 kept every one of these and added a fourth field to the same PUT</h2>
 *
 * The item dialog now leads with a Sales tax SELECT — follow the category, a named class, or
 * "a rate just for this item" — and the rate/code pair appears only under that last choice. This
 * fixture is deliberately the pre-F16 shape: a per-item 17% / SR-STD-17 with NO `taxClassId` and
 * NO `effectiveTaxSource`, exactly what a pos-service that has not been redeployed still sends.
 * The dialog has to read that as a custom rate from the item's own two columns; deciding it from
 * the server's caption would let a missing caption present a live 17% as "follows the category"
 * and clear it on the next save — S0-03, committed a second time by its own fix.
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
    // F16: the item dialog reads the tenant's rate catalogue to build its Sales tax select.
    // Returned EMPTY on purpose here — this fixture is the pre-F16 tenant, which has no classes
    // and whose dishes carry per-item rates. The dialog must still show and preserve that rate.
    http.get("*/api/v1/pos/tax-classes", () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
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
      // F16: null and PRESENT. The dish is on its own rate, so it names no class — but the key
      // travels, because pos-service reads an absent taxClassId exactly as it reads null.
      taxClassId: null,
    });
  });

  it("theEditDialogShowsTheItemsExistingTaxClassification", async () => {
    renderPage(() => {});
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    // The select opens ON the custom rate, unprompted — the fields are only reachable that way,
    // so if this reads anything else the two boxes below are not on screen at all.
    expect(within(dialog).getByRole("combobox", { name: "Sales tax" })).toHaveValue("CUSTOM");
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
    expect(putBody).toMatchObject({ taxRateCode: null, taxRatePct: 17, taxClassId: null });
    expect(putBody).toHaveProperty("taxRateCode");
  });

  /**
   * F16's own half of the same contract: moving a dish OFF its custom rate and onto the category
   * must clear both columns on the wire.
   *
   * <p>Leaving a stale 17.00% behind a dish that now reads "follows Starters" is not harmless —
   * it is a rate that re-appears, silently, the day somebody clears the class again, and it would
   * make the item's own row disagree with what the till charges.
   */
  it("switchingFromACustomRateToTheCategoryClearsBothColumns", async () => {
    let putBody: Record<string, unknown> | null = null;
    renderPage((b) => {
      putBody = b as Record<string, unknown>;
    });
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sales tax" }), "");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toMatchObject({ taxRatePct: 0, taxRateCode: null, taxClassId: null });
  });
});

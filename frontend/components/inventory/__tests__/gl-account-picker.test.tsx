import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { server } from "@/mocks/server";
import { CategoryFormDialog } from "@/components/inventory/CategoryFormDialog";

// gl-account-picker.test.tsx — the three GL account fields on the category form.
//
// They used to be plain <input> boxes that accepted literally anything: '1400', '14OO' (letter O)
// and 'banana' all saved identically, with no check that the account existed, was active, or was
// even the right TYPE. Nothing surfaced the mistake until Phase 9 posted journal entries against
// it, long after anyone could say which category was mistyped. These tests pin the replacement:
// searchable pickers whose options are narrowed server-side per slot, driven end to end through
// the real MSW gl-accounts handler.
//
// The MSW chart of accounts (mocks/inventory.handlers.ts): 1400 Food Inventory / 1410 Beverage
// Inventory (ASSET), 5010 Food Cost / 5020 Beverage Cost (COGS), 6100 Wastage & Spoilage (EXPENSE).

// "Poultry" — an L2 category that inherits every GL account from "Meat & Poultry" (L1).
const CAT_POULTRY = "71111111-1111-4111-8111-111111110002";

function renderCreateDialog(defaultParentId?: string | null) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <CategoryFormDialog
        defaultParentId={defaultParentId}
        trigger={<button type="button">Open category form</button>}
      />
    </Wrapper>,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open category form" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

/**
 * The field's OWN control, not the "?" beside its label. Every labelled field now carries a
 * FieldHelp trigger, so a form item holding a combobox holds two buttons and a bare
 * `getByRole("button")` is ambiguous.
 */
function fieldControl(group: HTMLElement) {
  const control = within(group)
    .getAllByRole("button")
    .find((button) => button.getAttribute("data-slot") !== "field-help");
  if (!control) throw new Error("No control button in this form item");
  return control;
}

/** Opens the picker sitting under `label` and returns its listbox popover. */
async function openPicker(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  label: string,
) {
  const group = within(dialog).getByText(label).closest("[data-slot='form-item']") as HTMLElement;
  await user.click(fieldControl(group ?? dialog));
  return { group };
}

describe("Category form — GL account pickers", () => {
  afterEach(() => clearSession());

  it("glAccountFieldsAreNoLongerFreeTextInputs", async () => {
    seedSession();
    renderCreateDialog();
    const { dialog } = await openDialog();

    // The regression that matters: if any of these ever renders as a textbox again, a manager can
    // type an account that does not exist and the form will happily submit it.
    for (const label of ["Inventory GL account", "Cost GL account", "Waste GL account"]) {
      const group = within(dialog)
        .getByText(label)
        .closest("[data-slot='form-item']") as HTMLElement;
      expect(group).not.toBeNull();
      expect(within(group).queryByRole("textbox")).toBeNull();
      expect(fieldControl(group)).toBeInTheDocument();
    }
  });

  it("theInventorySlotOffersOnlyAssetAccounts", async () => {
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");

    // Narrowing happens server-side off `usage`, so an asset slot never even receives the COGS
    // accounts — the browser is not trusted to filter the chart of accounts.
    await waitFor(() => {
      expect(screen.getByText("1400 · Food Inventory")).toBeInTheDocument();
    });
    expect(screen.getByText("1410 · Beverage Inventory")).toBeInTheDocument();
    expect(screen.queryByText("5010 · Food Cost")).toBeNull();
    expect(screen.queryByText("6100 · Wastage & Spoilage")).toBeNull();
  }, 15000);

  it("theCostSlotOffersCogsAndExpenseAccountsButNoAssets", async () => {
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Cost GL account");

    await waitFor(() => {
      expect(screen.getByText("5010 · Food Cost")).toBeInTheDocument();
    });
    expect(screen.getByText("6100 · Wastage & Spoilage")).toBeInTheDocument();
    expect(screen.queryByText("1400 · Food Inventory")).toBeNull();
  }, 15000);

  it("selectingAnAccountShowsItsCodeAndNameAndIsAnnouncedToScreenReaders", async () => {
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    const { group } = await openPicker(user, dialog, "Inventory GL account");
    await waitFor(() => {
      expect(screen.getByText("1400 · Food Inventory")).toBeInTheDocument();
    });
    await user.click(screen.getByText("1400 · Food Inventory"));

    // Visible label...
    await waitFor(() => {
      expect(within(group).getByText("1400 · Food Inventory")).toBeInTheDocument();
    });
    // ...and the ACCESSIBLE name, which used to stay stuck on the placeholder forever
    // (08.2 deferred-items.md) — a screen-reader user could never tell what was selected.
    expect(
      within(group).getByRole("button", { name: "1400 · Food Inventory" }),
    ).toBeInTheDocument();
  }, 15000);

  it("aSubcategoryShowsTheAccountItWouldInheritRatherThanLookingEmpty", async () => {
    seedSession();
    // Creating a child of Poultry, which itself inherits 1310/5010/5910 from Meat & Poultry.
    renderCreateDialog(CAT_POULTRY);
    const { dialog } = await openDialog();

    // An untouched field is not "blank" — the category has an effective account, and the
    // placeholder says which and where it came from, so nobody sets a redundant override.
    await waitFor(() => {
      expect(within(dialog).getByText(/Inherited from Meat & Poultry — 1310/)).toBeInTheDocument();
    });
    expect(within(dialog).getByText(/Inherited from Meat & Poultry — 5010/)).toBeInTheDocument();
  }, 15000);
});

// ── When the lookup fails ────────────────────────────────────────────────────────────────────
//
// The picker used to answer EVERY failure with "the accounting service isn't reachable right
// now". The first time it fired in anger, finance-service was up and healthy and inventory-service
// was returning 404 for its own route — so the message sent whoever read it to the wrong logs.
// A wrong attribution is worse than a vague one: it spends someone's afternoon.

/** Makes the gl-accounts lookup fail with a given envelope, for this test only. */
function failLookupWith(code: string, message: string, status: number) {
  server.use(
    http.get("*/api/v1/inventory/gl-accounts", () =>
      HttpResponse.json({ error: { code, message, details: [], traceId: "t" } }, { status }),
    ),
  );
}

describe("Category form — when the accounts lookup fails", () => {
  afterEach(() => clearSession());

  it("a503FromTheFinanceSeamIsTheOneCaseThatNamesTheAccountingService", async () => {
    failLookupWith("FINANCE_UNAVAILABLE", "finance-service unavailable", 503);
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");

    // GlAccountLookupService turns anything that reaches finance into this code, never into an
    // empty list — so it is the only signal that finance itself is genuinely the problem.
    expect(await screen.findByText(/accounting service isn't responding/)).toBeInTheDocument();
  }, 15000);

  it("anyOtherFailureDoesNotBlameTheAccountingService", async () => {
    // The exact shape of the original sighting: inventory-service running a build that predated
    // its own gl-accounts route, so the request never got anywhere near finance.
    failLookupWith("NOT_FOUND", "No static resource api/v1/inventory/gl-accounts", 404);
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");

    expect(
      await screen.findByText(/Something went wrong loading the accounts list/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/accounting service/)).toBeNull();
  }, 15000);

  it("aTransientFailureCanBeRetriedWithoutLosingTheHalfFilledForm", async () => {
    // Counted per USAGE, not per request: the form mounts three pickers at once, so a plain
    // "fail the first call" would land on whichever of them happened to race first.
    let inventoryCalls = 0;
    server.use(
      http.get("*/api/v1/inventory/gl-accounts", ({ request }) => {
        const usage = new URL(request.url).searchParams.get("usage");
        if (usage !== "INVENTORY") {
          return HttpResponse.json({ data: [], meta: null, warnings: [] });
        }
        inventoryCalls += 1;
        if (inventoryCalls === 1) {
          return HttpResponse.json(
            { error: { code: "FINANCE_UNAVAILABLE", message: "down", details: [], traceId: "t" } },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          data: [
            {
              // A real UUID: the response schema requires one, and a placeholder here would
              // fail the parse and leave this test asserting the error path it means to escape.
              id: "a1111111-1111-4111-8111-111111110001",
              code: "1400",
              name: "Food Inventory",
              accountType: "ASSET",
            },
          ],
          meta: null,
          warnings: [],
        });
      }),
    );
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    // Closing the dialog to shake off a blip that lasted two seconds would throw away
    // everything already typed into the other fields.
    expect(await screen.findByText("1400 · Food Inventory")).toBeInTheDocument();
  }, 20000);

  it("anEmptyChartOfAccountsSaysSoRatherThanBlamingTheSearch", async () => {
    // Not a failure — a 200 with nothing in it. This is what a tenant whose finance module was
    // never provisioned actually sees, and it looked identical to a typo in the search box.
    server.use(
      http.get("*/api/v1/inventory/gl-accounts", () =>
        HttpResponse.json({ data: [], meta: null, warnings: [] }),
      ),
    );
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");

    expect(await screen.findByText("No accounts set up yet")).toBeInTheDocument();
    expect(screen.getByText(/no asset accounts yet/)).toBeInTheDocument();
    // The old copy pointed at the search term, which the manager cannot fix by retyping.
    expect(screen.queryByText("No matching accounts")).toBeNull();
  }, 15000);

  it("aPermissionRefusalOffersNoRetryBecauseRetryingCannotHelp", async () => {
    failLookupWith("PERMISSION_DENIED", "forbidden", 403);
    seedSession();
    renderCreateDialog();
    const { user, dialog } = await openDialog();

    await openPicker(user, dialog, "Inventory GL account");

    // A button that cannot possibly work is worse than no button: it invites the reader to keep
    // pressing it instead of asking an administrator.
    expect(await screen.findByText(/Your role doesn't include browsing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  }, 15000);
});

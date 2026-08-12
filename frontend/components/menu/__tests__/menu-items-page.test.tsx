import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { toast } from "sonner";
import MenuItemsPage from "@/app/(tenant)/app/menu/items/page";

// The app mounts <Toaster /> at the layout level, which these component-scoped tests do not — so
// a toast leaves no DOM to query. Spying is how the confirmation can still be asserted.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// menu-items-page.test.tsx — pos-service already had a complete, working, event-publishing
// item CRUD API; nothing in the frontend ever called it, and menu CATEGORIES had no create path
// anywhere at all (every tenant's were hand-inserted via a seed script). This is the first UI
// for either. Driven end to end through the real MSW menu handlers.

const CAT_MAINS = "c1000001-0000-4000-8000-000000000001";
const CAT_DESSERTS = "c1000001-0000-4000-8000-000000000002";

const rawCategoriesAdmin = [
  { id: CAT_MAINS, name: "Mains", description: null, sortOrder: 1, active: true },
  { id: CAT_DESSERTS, name: "Desserts", description: null, sortOrder: 2, active: false },
];
const rawCategoriesActive = rawCategoriesAdmin.filter((c) => c.active);

const rawItemsAdmin = [
  {
    id: "a1000001-0000-4000-8000-000000000001",
    categoryId: CAT_MAINS,
    categoryName: "Mains",
    name: "Chicken Karahi",
    description: null,
    basePricePaisa: 65000,
    taxRatePct: "0",
    kdsStation: null,
    active: true,
  },
  {
    id: "a1000001-0000-4000-8000-000000000002",
    categoryId: CAT_MAINS,
    categoryName: "Mains",
    name: "Old Special",
    description: null,
    basePricePaisa: 40000,
    taxRatePct: "0",
    kdsStation: null,
    active: false,
  },
];

function mockMenuAdminEndpoints() {
  server.use(
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: rawCategoriesAdmin, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategoriesActive, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items/admin", () =>
      HttpResponse.json({ data: rawItemsAdmin, meta: null, warnings: [] }),
    ),
  );
}

function renderPage() {
  seedSession({ permissions: ["pos.menu.manage"] });
  mockMenuAdminEndpoints();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <MenuItemsPage />
    </Wrapper>,
  );
}

describe("Menu Items page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("showsOnlyActiveCategoriesAndItemsByDefault", async () => {
    renderPage();

    expect(await screen.findByText("Mains")).toBeInTheDocument();
    expect(await screen.findByText("Chicken Karahi")).toBeInTheDocument();
    expect(screen.queryByText("Desserts")).toBeNull();
    expect(screen.queryByText("Old Special")).toBeNull();
  });

  it("showInactiveRevealsTheDeactivatedCategoryAndItemWithABadge", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Chicken Karahi");

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));

    expect(await screen.findByText("Desserts")).toBeInTheDocument();
    expect(await screen.findByText("Old Special")).toBeInTheDocument();
    expect(screen.getAllByText("Inactive").length).toBeGreaterThanOrEqual(2);
  });

  it("addingACategoryPostsTheRealFieldsAndConfirms", async () => {
    let posted: unknown = null;
    server.use(
      http.post("*/api/v1/pos/menu/categories", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          data: {
            id: "c1000001-0000-4000-8000-000000000099",
            name: "Drinks",
            description: null,
            sortOrder: 3,
            active: true,
          },
          meta: null,
          warnings: [],
        });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Chicken Karahi");

    await user.click(screen.getByRole("button", { name: "Add category" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Drinks");
    await user.click(within(dialog).getByRole("button", { name: "Add category" }));

    await waitFor(() => expect(posted).toEqual({ name: "Drinks" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added Drinks"));
  });

  it("addingAnItemUnderMainsPostsThePriceInPaisa", async () => {
    let posted: { basePricePaisa?: number } | null = null;
    server.use(
      http.post("*/api/v1/pos/menu/items", async ({ request }) => {
        posted = (await request.json()) as { basePricePaisa?: number };
        return HttpResponse.json({
          data: {
            id: "a1000001-0000-4000-8000-000000000099",
            categoryId: CAT_MAINS,
            categoryName: "Mains",
            name: "Biryani",
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
    );
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Chicken Karahi");

    // Add item scoped to the Mains category's own group, not the header button (which ALSO
    // reads "Add item") — proves the row's action pre-selects its own category rather than
    // leaving the picker on whichever category happened to be first.
    const mainsGroup = screen.getByRole("group", { name: "Mains category" });
    await user.click(within(mainsGroup).getByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Biryani");
    // 550 rupees -> 55000 paisa: the same conversion every other money field in this app uses.
    await user.type(within(dialog).getByRole("textbox", { name: "Price (Rs)" }), "550");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));

    // `imageFileId: null` is sent EXPLICITLY even when no picture was chosen, and this
    // assertion exists to keep it that way (19b). The backend reads a null/absent imageFileId on
    // UPDATE as "remove the picture", so the form always sends the key rather than omitting it —
    // otherwise a price-only edit would silently delete an item's photo. Create is asserted here
    // because it is where the convention would most easily drift back to omission.
    // `taxRatePct: 0` / `taxRateCode: null` join it for the same reason (S0-03): the dialog now
    // carries a tax rate and a tax code, and it states them on every save rather than omitting
    // them — an omitted taxRateCode is how a description-only EDIT used to erase 'SR-STD-17'.
    await waitFor(() =>
      expect(posted).toEqual({
        categoryId: CAT_MAINS,
        name: "Biryani",
        basePricePaisa: 55000,
        taxRatePct: 0,
        taxRateCode: null,
        imageFileId: null,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added Biryani"));
  });

  it("editingACategoryPutsTheRenamedFieldsAndConfirms", async () => {
    let putBody: unknown = null;
    server.use(
      http.put(
        "*/api/v1/pos/menu/categories/c1000001-0000-4000-8000-000000000001",
        async ({ request }) => {
          putBody = await request.json();
          return HttpResponse.json({
            data: {
              id: CAT_MAINS,
              name: "Main Courses",
              description: "renamed",
              sortOrder: 1,
              active: true,
            },
            meta: null,
            warnings: [],
          });
        },
      ),
    );
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Chicken Karahi");

    await user.click(screen.getByRole("button", { name: "Actions for Mains" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    // Pre-filled from the existing category, not blank — this is a rename, not a new entry.
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Mains");

    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Main Courses");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(putBody).toEqual({ name: "Main Courses", description: "renamed", sortOrder: 1 }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Updated Main Courses"));
  });

  it("deactivatingAnItemCallsTheRealEndpointAndConfirms", async () => {
    let deactivateCalled = false;
    server.use(
      http.patch("*/api/v1/pos/menu/items/a1000001-0000-4000-8000-000000000001/deactivate", () => {
        deactivateCalled = true;
        return HttpResponse.json({
          data: { ...rawItemsAdmin[0], active: false },
          meta: null,
          warnings: [],
        });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Chicken Karahi");

    await user.click(screen.getByRole("button", { name: "Actions for Chicken Karahi" }));
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));

    await waitFor(() => expect(deactivateCalled).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deactivated Chicken Karahi"));
  });
});

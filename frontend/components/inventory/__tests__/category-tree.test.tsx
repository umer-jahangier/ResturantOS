import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { CategoryTree } from "@/components/inventory/category-tree";
import type { ItemCategory, ItemCategoryNode } from "@/lib/adapters/inventory.adapter";
import CategoriesPage from "@/app/(tenant)/app/inventory/categories/page";

// category-tree.test.tsx — 08.2-14 Task 3: the 3-level cap (Add-subcategory hidden at level 3),
// the "Move to…" valid-targets filter (self/descendants/level-3 excluded), inherited-GL-account
// labelling (all category-tree.tsx), and the archive-refusal inline-banner contract driven end
// to end through the real MSW category handlers (categories/page.tsx).

function makeGl(
  overrides: Partial<ItemCategory["resolvedGlAccounts"]> = {},
): ItemCategory["resolvedGlAccounts"] {
  return {
    inventoryAccountCode: null,
    costAccountCode: null,
    wasteAccountCode: null,
    inventoryInherited: false,
    costInherited: false,
    wasteInherited: false,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<ItemCategory> = {}): ItemCategory {
  return {
    id: "10000000-0000-4000-8000-000000000000",
    parentId: null,
    level: 1,
    code: null,
    name: "Category",
    defaultInventoryAccountCode: null,
    defaultCostAccountCode: null,
    defaultWasteAccountCode: null,
    varianceCapPct: null,
    excludeFromPoSuggestions: false,
    sortOrder: 0,
    archivedAt: null,
    ingredientCount: 0,
    resolvedGlAccounts: makeGl(),
    ...overrides,
  };
}

const noop = () => {};

/** Meat & Poultry (L1, owns its inventory GL account) -> Poultry (L2, inherits it) ->
 * Chicken (L3, the depth-cap boundary) ; two empty L1 siblings (Dry Goods, Beverages). */
function threeLevelTree(): ItemCategoryNode[] {
  const chicken: ItemCategoryNode = {
    category: makeCategory({
      id: "10000000-0000-4000-8000-000000000003",
      parentId: "10000000-0000-4000-8000-000000000002",
      level: 3,
      name: "Chicken",
    }),
    children: [],
  };
  const poultry: ItemCategoryNode = {
    category: makeCategory({
      id: "10000000-0000-4000-8000-000000000002",
      parentId: "10000000-0000-4000-8000-000000000001",
      level: 2,
      name: "Poultry",
      resolvedGlAccounts: makeGl({ inventoryAccountCode: "1310", inventoryInherited: true }),
    }),
    children: [chicken],
  };
  const meat: ItemCategoryNode = {
    category: makeCategory({
      id: "10000000-0000-4000-8000-000000000001",
      parentId: null,
      level: 1,
      name: "Meat & Poultry",
      defaultInventoryAccountCode: "1310",
      resolvedGlAccounts: makeGl({ inventoryAccountCode: "1310", inventoryInherited: false }),
    }),
    children: [poultry],
  };
  const dryGoods: ItemCategoryNode = {
    category: makeCategory({
      id: "10000000-0000-4000-8000-000000000004",
      level: 1,
      name: "Dry Goods",
    }),
    children: [],
  };
  const beverages: ItemCategoryNode = {
    category: makeCategory({
      id: "10000000-0000-4000-8000-000000000005",
      level: 1,
      name: "Beverages",
    }),
    children: [],
  };
  return [meat, dryGoods, beverages];
}

function renderTree(nodes: ItemCategoryNode[]) {
  return render(
    <CategoryTree
      nodes={nodes}
      onEdit={noop}
      onAddChild={noop}
      onMove={noop}
      onArchive={noop}
      onRestore={noop}
    />,
  );
}

describe("CategoryTree — 3-level cap, move-target filter, inherited GL labelling (INV-13)", () => {
  it("addSubcategoryIsHiddenOnALevelThreeNode", async () => {
    renderTree(threeLevelTree());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Chicken" }));

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add subcategory" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
  });

  it("moveTargetsExcludeSelfAndDescendants", async () => {
    renderTree(threeLevelTree());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Poultry" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to" }));

    // Valid targets for Poultry (level 2, subtree height 2) are the three level-1 roots only.
    expect(await screen.findByRole("menuitem", { name: "Meat & Poultry" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Dry Goods" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Beverages" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Poultry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chicken" })).not.toBeInTheDocument();
  });

  it("moveTargetsExcludeLevelThreeNodes", async () => {
    renderTree(threeLevelTree());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Dry Goods" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to" }));

    expect(await screen.findByRole("menuitem", { name: "Meat & Poultry" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Poultry" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chicken" })).not.toBeInTheDocument();
  });

  it("inheritedGlAccountsAreLabelled", () => {
    renderTree(threeLevelTree());

    // Poultry inherits its inventory GL account from Meat & Poultry, which owns it directly —
    // exactly one "(inherited)" suffix exists across the rendered tree.
    expect(screen.getAllByText("(inherited)")).toHaveLength(1);
  });
});

describe("Categories page — archive refusal (INV-13, T-08.2-142)", () => {
  afterEach(() => clearSession());

  it("archiveRefusalKeepsTheDialogOpenAndShowsTheServerMessage", async () => {
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CategoriesPage />
      </Wrapper>,
    );

    const user = userEvent.setup();

    // Poultry — the real MSW fixture — has exactly one non-archived ingredient assigned, so
    // archiving it drives the mock's real CATEGORY_IN_USE refusal with a live interpolated count.
    await user.click(await screen.findByRole("button", { name: "Actions for Poultry" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive category" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/1 ingredient/);
    // Never a silent toast-only failure — the dialog must still be in the document.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Categories page — Show archived toggle", () => {
  afterEach(() => clearSession());

  // An archived category still reserves its name (the DB constraint makes no exception for it),
  // so without a way to SEE archived rows a manager can be told a name "already exists" while
  // looking at a screen that shows nothing with that name. This toggle is the only way to find,
  // and restore, whichever archived category is actually holding it.
  //
  // Each test creates its OWN category (via the real "Add category" flow) rather than archiving
  // one of the shared MSW fixtures — `categories` is module-level state that outlives a single
  // test, so two tests sharing one fixture row would leak archived/restored state between them.

  async function createTestCategory(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByRole("button", { name: "Add category" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), name);
    // The dialog's own submit button is ALSO labelled "Add category" (create mode) — scoped to
    // the dialog so it can't be confused with the header button that opened it.
    await user.click(within(dialog).getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("archivingACategoryHidesItByDefaultAndTheToggleBringsItBackWithABadge", async () => {
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CategoriesPage />
      </Wrapper>,
    );
    const user = userEvent.setup();
    const name = "Toggle Test A";
    await createTestCategory(user, name);

    await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    const archiveDialog = await screen.findByRole("dialog");
    await user.click(within(archiveDialog).getByRole("button", { name: "Archive category" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Gone from the default (live-only) view — the exact state that made "already exists" read
    // as wrong to a manager who has never checked this box.
    await waitFor(() => expect(screen.queryByText(name)).toBeNull());

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

    const row = (await screen.findByText(name)).closest("[role='treeitem']") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: `Actions for ${name}` })).toBeInTheDocument();

    // Unchecking hides it again — proves the toggle actually drives the fetch both directions,
    // not just a one-time reveal.
    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));
    await waitFor(() => expect(screen.queryByText(name)).toBeNull());

    // Restored so this test leaves `categories` — module-level MSW fixture state that outlives
    // this one test — exactly as it found it, rather than leaking a permanently-archived row into
    // whichever test runs next in this file.
    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));
    await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByText("Archived")).toBeNull());
  });

  it("theArchivedRowsRestoreActionWorksFromTheToggledOnView", async () => {
    seedSession({ permissions: ["inventory.item.view", "inventory.item.manage"] });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CategoriesPage />
      </Wrapper>,
    );
    const user = userEvent.setup();
    const name = "Toggle Test B";
    await createTestCategory(user, name);

    await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    const archiveDialog = await screen.findByRole("dialog");
    await user.click(within(archiveDialog).getByRole("button", { name: "Archive category" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));
    // Scoped to this row, not a bare screen.findByText("Archived") — another archived category
    // (from this file's other tests, or added later) would make that ambiguous.
    const row = (await screen.findByText(name)).closest("[role='treeitem']") as HTMLElement;
    await waitFor(() => expect(within(row).getByText("Archived")).toBeInTheDocument());

    await user.click(within(row).getByRole("button", { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Restore" }));

    // Restored — no longer carries the badge, and shows up even with the toggle switched back off.
    await waitFor(() => expect(within(row).queryByText("Archived")).toBeNull());
    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));
    expect(await screen.findByText(name)).toBeInTheDocument();
  });
});

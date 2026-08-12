import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuCategoryAssignmentField } from "@/components/users/menu-category-assignment-field";
import { UserDetailPanel } from "@/components/users/user-detail-panel";
import { adaptUserMenuCategoryScope } from "@/lib/adapters/user.adapter";

/**
 * Program A's frontend half — the writer that never existed.
 *
 * <p>The table, the RLS policy, the two endpoints, the JWT claim, the rego rules, the grid filter
 * and the add-item refusal all shipped before this. No screen could write a row, so every user's
 * scope was empty, so the claim was always absent, so the till showed all 394 items. These tests
 * pin the four things that would silently restore that state.
 *
 * <h3>Every assertion here WAITS FOR an element</h3>
 *
 * Not one of them is `waitFor(() => expect(queryBy…).not.toBeInTheDocument())`. That shape passes
 * against a component that renders nothing at all — including one whose guard has been deleted —
 * because "not yet rendered" and "correctly withheld" are the same observation at t=0. Where an
 * absence genuinely is the property under test it is paired with a positive control: the element
 * that MUST be there is awaited first, and only then is its sibling's absence meaningful.
 */

const OWNER = {
  roles: ["OWNER"],
  permissions: ["rbac.manage", "rbac.user.manage", "rbac.role.manage", "pos.menu.manage"],
};

// Real UUIDv4s: `z.string().uuid()` in Zod 4 checks the version and variant nibbles, so a
// "11111111-…" placeholder is rejected by the schema rather than by the assertion.
const DRINKS = "1c5f7cbe-4f3a-4f2e-9a3f-2a5f6b8c1d2e";
const MAINS = "2d6a8dcf-5a4b-4b3f-8b4a-3b6a7c9d2e3f";
const RETIRED = "3e7b9ea0-6b5c-4c4a-9c5b-4c7b8dae3f40";

function categoryRows() {
  return [
    { id: DRINKS, name: "Main Bar", description: null, sortOrder: 1, active: true },
    { id: MAINS, name: "Mains", description: null, sortOrder: 2, active: true },
    { id: RETIRED, name: "Retired Specials", description: null, sortOrder: 3, active: false },
  ];
}

function mockCategoryCatalogue() {
  server.use(
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: categoryRows() }),
    ),
  );
}

function renderWithQuery(node: React.ReactElement) {
  const Wrapper = createQueryWrapper();
  return render(<Wrapper>{node}</Wrapper>);
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("the assignment field is a real multi-select over the real catalogue", () => {
  it("offers every ACTIVE category and ticks several onto one user", async () => {
    mockCategoryCatalogue();
    seedSession(OWNER);
    const onChange = vi.fn();

    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[]} onChange={onChange} />,
    );

    // Wait FOR the option, rather than asserting the picker is not empty.
    const bar = await screen.findByRole("checkbox", { name: /Main Bar/ });
    expect(await screen.findByRole("checkbox", { name: /Mains/ })).toBeInTheDocument();

    // The positive control that gives the next line meaning: two boxes ARE on screen, so the
    // absence of the third is a decision this component made rather than a component that has not
    // rendered yet.
    expect(screen.queryByRole("checkbox", { name: /Retired Specials/ })).not.toBeInTheDocument();

    await userEvent.click(bar);
    expect(onChange).toHaveBeenCalledWith([DRINKS]);

    // "assign multiple menu to a user" — the owner's words. A second tick must ADD, not replace.
    onChange.mockClear();
    cleanup();
    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[DRINKS]} onChange={onChange} />,
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: /Mains/ }));
    expect(onChange).toHaveBeenCalledWith([DRINKS, MAINS].sort());
  });

  it("says IN WORDS that selecting nothing means the whole menu", async () => {
    mockCategoryCatalogue();
    seedSession(OWNER);

    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[]} onChange={() => {}} />,
    );

    const summary = await screen.findByTestId("menu-category-assignment-summary");
    // The documented default, spelled out. An empty multi-select otherwise reads as
    // "nothing allowed" — the one wrong conclusion an owner would act on.
    expect(summary).toHaveTextContent(/WHOLE menu/i);
    expect(summary).toHaveTextContent(/default/i);
  });

  it("names the restriction, and does not claim a restricted user has the whole menu", async () => {
    mockCategoryCatalogue();
    seedSession(OWNER);

    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[DRINKS]} onChange={() => {}} />,
    );

    const summary = await screen.findByTestId("menu-category-assignment-summary");
    expect(summary).toHaveTextContent(/Main Bar/);
    // The mutation this catches: a summary that renders the unrestricted sentence for every state.
    expect(summary).not.toHaveTextContent(/WHOLE menu/i);
  });

  it("refuses to call a scope of only-inactive categories 'the whole menu'", async () => {
    mockCategoryCatalogue();
    seedSession(OWNER);

    // The trap: `selectedNames` is empty because nothing matched the catalogue, but `value` is not.
    // Reading the first as "unrestricted" would tell an owner their confined cashier can sell
    // everything, when the server will let them sell nothing.
    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[RETIRED]} onChange={() => {}} />,
    );

    const summary = await screen.findByTestId("menu-category-assignment-summary");
    expect(summary).toHaveTextContent(/can ring nothing/i);
    expect(await screen.findByTestId("menu-category-assignment-unlisted")).toBeInTheDocument();
  });

  it("renders the ERROR state, with a retry, rather than an empty picker", async () => {
    server.use(
      http.get("*/api/v1/pos/menu/categories/admin", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    seedSession(OWNER);

    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[]} onChange={() => {}} />,
    );

    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();
    // A failed catalogue read must not render as "this restaurant has no sections", because an
    // admin who saves over that has cleared a boundary they never saw.
    expect(screen.queryByTestId("menu-category-assignment-options")).not.toBeInTheDocument();
  });

  it("offers a clear that spells unrestricted the way the system spells it — empty", async () => {
    mockCategoryCatalogue();
    seedSession(OWNER);
    const onChange = vi.fn();

    renderWithQuery(
      <MenuCategoryAssignmentField branchLabel="Terrace" value={[DRINKS]} onChange={onChange} />,
    );

    await userEvent.click(await screen.findByTestId("menu-category-assignment-clear"));
    // NOT "every category id" — 51 UUIDs in every request header for the same effect, and a
    // category created next week would be one this "unrestricted" user could not sell.
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("the adapter keeps 'no rows' and 'no access' apart", () => {
  it("reports an empty response as unrestrictedEverywhere", () => {
    expect(adaptUserMenuCategoryScope([]).unrestrictedEverywhere).toBe(true);
  });

  it("drops a branch that came back with an empty list rather than reporting a restriction", () => {
    const scope = adaptUserMenuCategoryScope([
      { branchId: "4f8cafb1-7c6d-4d5b-ad6c-5d8caebf4051", categoryIds: [] },
    ]);
    expect(scope.unrestrictedEverywhere).toBe(true);
    expect(scope.branches).toHaveLength(0);
  });

  it("reports a real assignment as a restriction", () => {
    const scope = adaptUserMenuCategoryScope([
      { branchId: "4f8cafb1-7c6d-4d5b-ad6c-5d8caebf4051", categoryIds: [DRINKS] },
    ]);
    expect(scope.unrestrictedEverywhere).toBe(false);
    expect(scope.branches[0]!.categoryIds).toEqual([DRINKS]);
  });
});

describe("the detail panel reports the scope the server actually holds", () => {
  const USER_ID = "9e11ef06-4bfa-4fc2-af4f-b2063b297662";
  const BRANCH_ID = "4f8cafb1-7c6d-4d5b-ad6c-5d8caebf4051";

  function mockUserDetail() {
    server.use(
      http.get(`*/api/v1/users/${USER_ID}`, () =>
        HttpResponse.json({
          data: {
            user: {
              id: USER_ID,
              email: "cashier@terrace.local",
              fullName: "Counter Cashier",
              locale: "en",
              active: true,
              mustChangePassword: false,
              totpEnabled: false,
              lastLoginAt: null,
              createdAt: "2026-08-01T00:00:00Z",
            },
            assignments: [],
          },
        }),
      ),
      http.get(`*/api/v1/users/${USER_ID}/stations`, () => HttpResponse.json({ data: [] })),
    );
  }

  it("says 'the whole menu' for a user with no assignment — the state everyone is in", async () => {
    mockUserDetail();
    mockCategoryCatalogue();
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/menu-categories`, () => HttpResponse.json({ data: [] })),
    );
    seedSession(OWNER);

    renderWithQuery(<UserDetailPanel userId={USER_ID} />);

    const line = await screen.findByTestId("user-menu-category-unrestricted");
    expect(line).toHaveTextContent(/whole menu/i);
  });

  it("names the branch and the sections for a user who IS confined", async () => {
    mockUserDetail();
    mockCategoryCatalogue();
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/menu-categories`, () =>
        HttpResponse.json({ data: [{ branchId: BRANCH_ID, categoryIds: [DRINKS] }] }),
      ),
    );
    seedSession(OWNER);

    renderWithQuery(<UserDetailPanel userId={USER_ID} />);

    const section = await screen.findByTestId("user-menu-category-scope");
    // The category NAME, resolved from the catalogue — an owner does not recognise a UUID, and a
    // panel that printed one would be reporting the row rather than the decision.
    await waitFor(() => expect(section).toHaveTextContent("Main Bar"));
    // The positive control for the absence: the section IS on screen and DOES name the category,
    // so the missing unrestricted sentence is a decision rather than an unrendered tree.
    expect(screen.queryByTestId("user-menu-category-unrestricted")).not.toBeInTheDocument();
  });
});

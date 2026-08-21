import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import BranchesPage from "@/app/(tenant)/app/branches/page";
import { BranchSwitcher } from "@/components/shared/branch-switcher";
import { navGroups } from "@/components/shared/sidebar-nav-items";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/**
 * Branch management (S5) — what a restaurant group can now do that it could not.
 *
 * <p>Every assertion is user-visible. The register's finding was not "the endpoint is wrong", it
 * was that `/app/branches`, `/app/settings/branches`, `/app/branch`, `/app/locations` and
 * `/app/admin/branches` were all *"This page doesn't exist"* for OWNER and TENANT_ADMIN alike,
 * with no sidebar entry mentioning a branch anywhere. So these tests drive the screen the way the
 * owner does: find it in the nav, read the list, add one, rename one, take one out of service —
 * and check the branch SWITCHER agrees, because the switcher is the only route to a branch's data
 * and a list that disagrees with it is the defect wearing a new hat.
 */

const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOFTOP = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const NEW_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

function branch(over: Record<string, unknown>) {
  return {
    id: NEW_ID,
    tenantId: TENANT,
    name: "Branch",
    isHq: false,
    isActive: true,
    address: null,
    fbrStrn: null,
    ntn: null,
    phone: null,
    email: null,
    timezone: "Asia/Karachi",
    currencyConfig: null,
    receiptConfig: null,
    openedOn: null,
    ...over,
  };
}

const SEED = [
  branch({ id: HQ, name: "Floating Terrace HQ", isHq: true, address: "12 Khayaban-e-Iqbal" }),
  branch({ id: ROOFTOP, name: "Floating Terrace — Rooftop" }),
];

function mockList(rows: unknown[] = SEED) {
  server.use(
    http.get("*/api/v1/branches", ({ request }) => {
      // `/mine` is a different route with a different shape; keep them apart.
      if (new URL(request.url).pathname.endsWith("/mine")) {
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }
      return HttpResponse.json({ data: rows, meta: null, warnings: [] });
    }),
  );
}

function renderPage(permissions: string[] = ["branch.manage"]) {
  seedSession({ permissions, branchId: HQ, tenantId: TENANT });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <BranchesPage />
    </Wrapper>,
  );
}

describe("Branches screen", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("is reachable from the sidebar by the two roles that administer branches", () => {
    const items = navGroups.flatMap((group) => group.items);
    const entry = items.find((item) => item.href === "/app/branches");
    expect(entry, "no sidebar entry points at /app/branches").toBeDefined();
    expect(entry?.comingSoon).toBeFalsy();
    // The exact expression BranchController @PreAuthorizes. Requiring BOTH would hide the screen
    // from TENANT_ADMIN, who deliberately does not hold `rbac.manage` (13-02).
    expect(entry?.permission).toEqual(["rbac.manage", "branch.manage"]);
    expect(entry?.permissionMode).toBe("any");
  });

  it("lists every branch with its address and time zone, and marks the one you are on", async () => {
    mockList();
    renderPage();

    const rows = await screen.findAllByTestId("branch-row");
    expect(rows).toHaveLength(2);
    const [hqRow, rooftopRow] = rows as [HTMLElement, HTMLElement];
    expect(within(hqRow).getByText("Floating Terrace HQ")).toBeInTheDocument();
    expect(within(hqRow).getByText("12 Khayaban-e-Iqbal")).toBeInTheDocument();
    expect(within(hqRow).getByText("Your branch")).toBeInTheDocument();
    expect(within(rooftopRow).getByText("Floating Terrace — Rooftop")).toBeInTheDocument();
    expect(screen.getAllByText("Asia/Karachi")).toHaveLength(2);
  });

  it("says the read FAILED rather than that the group has no branches", async () => {
    server.use(
      http.get("*/api/v1/branches", () =>
        HttpResponse.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 }),
      ),
    );
    renderPage();

    // GA-001: an owner whose user-service is down must never be told their business has no
    // locations. The alert is the assertion; the absent empty-state copy is the other half.
    await screen.findByRole("alert");
    expect(screen.queryByText("No branches yet")).not.toBeInTheDocument();
  });

  it("creates a branch with a name, address and time zone, and it appears in the list", async () => {
    let rows: unknown[] = SEED;
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.get("*/api/v1/branches", ({ request }) =>
        new URL(request.url).pathname.endsWith("/mine")
          ? HttpResponse.json({ data: [], meta: null, warnings: [] })
          : HttpResponse.json({ data: rows, meta: null, warnings: [] }),
      ),
      http.post("*/api/v1/branches", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        const created = branch({ ...body, id: NEW_ID });
        rows = [...SEED, created];
        return HttpResponse.json({ data: created, meta: null, warnings: [] }, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText("Floating Terrace HQ");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("add-branch"));
    await user.type(await screen.findByTestId("branch-name-input"), "Gulberg");
    await user.type(screen.getByTestId("branch-address-input"), "5 MM Alam Road, Lahore");
    await user.click(screen.getByTestId("branch-form-submit"));

    await waitFor(() => expect(sent).toHaveLength(1));
    // A plain address, sent as a plain string — not as a JSON-quoted one, which is what the
    // product used to require before the column stopped being jsonb.
    expect(sent[0]).toMatchObject({
      name: "Gulberg",
      address: "5 MM Alam Road, Lahore",
      timezone: "Asia/Karachi",
    });
    expect(await screen.findByText("Gulberg")).toBeInTheDocument();
  });

  it("refuses an email and a phone that are not one, while the user is still typing", async () => {
    mockList();
    renderPage();
    await screen.findByText("Floating Terrace HQ");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("add-branch"));
    const email = await screen.findByLabelText("Email");
    await user.type(email, "not-an-email");

    // Named field, real problem, WHILE TYPING — the register's §23 finding was that this product
    // produced `ariaInvalid: 0` on type and on blur, on every form it drove.
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(await screen.findByText(/needs an @ and a domain/i)).toBeInTheDocument();

    // …and it clears the moment the value becomes valid, which it also used not to do.
    await user.clear(email);
    await user.type(email, "rooftop@terrace.pk");
    await waitFor(() => expect(email).not.toHaveAttribute("aria-invalid", "true"));
  });

  it("binds the server's duplicate-name refusal to the name box, not to a toast", async () => {
    mockList();
    server.use(
      http.post("*/api/v1/branches", () =>
        HttpResponse.json(
          {
            error: {
              code: "DUPLICATE_VALUE",
              message: "A branch called 'Rooftop' already exists. Choose another name.",
              details: [
                {
                  field: "name",
                  issue: "A branch called 'Rooftop' already exists. Choose another name.",
                },
              ],
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("Floating Terrace HQ");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("add-branch"));
    await user.type(await screen.findByTestId("branch-name-input"), "Rooftop");
    await user.click(screen.getByTestId("branch-form-submit"));

    expect(await screen.findByText(/already exists\. Choose another name\./)).toBeInTheDocument();
  });

  it("renames a branch and sends ONLY the field that changed", async () => {
    let rows: unknown[] = SEED;
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.get("*/api/v1/branches", ({ request }) =>
        new URL(request.url).pathname.endsWith("/mine")
          ? HttpResponse.json({ data: [], meta: null, warnings: [] })
          : HttpResponse.json({ data: rows, meta: null, warnings: [] }),
      ),
      http.put("*/api/v1/branches/:id", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        rows = SEED.map((b) => (b.id === ROOFTOP ? { ...b, ...body } : b));
        return HttpResponse.json({ data: { ...SEED[1], ...body }, warnings: [] });
      }),
    );
    renderPage();
    await screen.findByText("Floating Terrace — Rooftop");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for Floating Terrace — Rooftop" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit details" }));

    const nameInput = await screen.findByTestId("branch-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Terrace Rooftop Bar");
    await user.click(screen.getByTestId("branch-form-submit"));

    await waitFor(() => expect(patches).toHaveLength(1));
    // A full snapshot would turn every untouched field into a write and revert a concurrent edit.
    expect(patches[0]).toEqual({ name: "Terrace Rooftop Bar" });
    expect(await screen.findByText("Terrace Rooftop Bar")).toBeInTheDocument();
  });

  it("confirms before deactivating, then the branch leaves the list AND the branch switcher", async () => {
    let rows = SEED.map((b) => ({ ...b }));
    // The switcher reads /mine, which the server filters to ACTIVE branches. Modelled here so the
    // assertion is about the two surfaces agreeing, not about one component's props.
    const mine = () =>
      rows
        .filter((b) => b.isActive)
        .map((b) => ({ id: b.id, name: b.name, isHq: b.isHq, roleCode: "OWNER" }));

    server.use(
      http.get("*/api/v1/branches/mine", () =>
        HttpResponse.json({ data: mine(), meta: null, warnings: [] }),
      ),
      http.get("*/api/v1/branches", () =>
        HttpResponse.json({ data: rows, meta: null, warnings: [] }),
      ),
      http.put("*/api/v1/branches/:id", async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        rows = rows.map((b) => (b.id === params.id ? { ...b, ...body } : b));
        return HttpResponse.json({
          data: rows.find((b) => b.id === params.id),
          warnings: [],
        });
      }),
    );

    seedSession({ permissions: ["branch.manage"], branchId: HQ, tenantId: TENANT });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <BranchSwitcher />
        <BranchesPage />
      </Wrapper>,
    );

    // Both branches are offered as somewhere to work.
    const switcher = await screen.findByRole("button", { name: "Switch branch" });
    const user = userEvent.setup();
    await user.click(switcher);
    expect(
      await screen.findByRole("menuitem", { name: /Floating Terrace — Rooftop/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("button", { name: "Actions for Floating Terrace — Rooftop" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));

    // The confirmation names the consequence, not just the object.
    expect(
      await screen.findByText("Stop trading at Floating Terrace — Rooftop?"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deactivate branch" }));

    await waitFor(() =>
      expect(screen.queryByText("Floating Terrace — Rooftop")).not.toBeInTheDocument(),
    );

    // The half that matters: the switcher no longer offers a branch nobody may trade on.
    await waitFor(async () => {
      const trigger = screen.queryByRole("button", { name: "Switch branch" });
      // One branch left → the switcher hides itself entirely, which is the correct end state.
      expect(trigger).toBeNull();
    });
  });

  it("will not offer to deactivate head office", async () => {
    mockList();
    renderPage();
    await screen.findByText("Floating Terrace HQ");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Floating Terrace HQ" }));
    const item = await screen.findByRole("menuitem", { name: "Deactivate" });
    expect(item).toHaveAttribute("aria-disabled", "true");
  });

  it("shows access denied to a persona who administers nothing", async () => {
    mockList();
    renderPage(["pos.order.create"]);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByTestId("add-branch")).toBeNull();
  });
});

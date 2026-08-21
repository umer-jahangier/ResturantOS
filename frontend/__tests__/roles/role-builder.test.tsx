import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import RolesPage from "@/app/(tenant)/app/roles/page";
import { navGroups } from "@/components/shared/sidebar-nav-items";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/**
 * The role builder (S3) — what an administrator can now do that they could not.
 *
 * <p>The register's finding was not "the endpoint is wrong". Both reads had been live for months.
 * It was that `/app/roles` and `/app/settings/roles` were `404 This page doesn't exist` for the
 * OWNER, that the assign dialog offered a fixed list of eight with `checkboxes: 0`, and that
 * <b>nowhere in the product could anyone see what a role actually granted</b>.
 *
 * <p>So every assertion here is user-visible and driven the way an owner drives it: find it in the
 * nav, open the built-in Cashier role and READ its permissions grouped by module, tick a subset
 * into a new role, and watch the ceiling refusal arrive on the form. Nothing here asserts a prop.
 */

const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

/** Two modules, so "grouped by module" is a claim the test can actually falsify. */
const CATALOGUE = [
  {
    module: "pos",
    permissions: [
      { code: "pos.order.create", module: "pos", description: "Create POS orders" },
      { code: "pos.order.view", module: "pos", description: "View POS orders" },
      { code: "pos.order.void.any", module: "pos", description: "Void any POS order" },
    ],
  },
  {
    module: "rbac",
    permissions: [
      { code: "rbac.manage", module: "rbac", description: "Manage RBAC" },
      { code: "rbac.role.manage", module: "rbac", description: "Assign and revoke roles" },
    ],
  },
];

const CASHIER = {
  code: "CASHIER",
  name: "Cashier",
  system: true,
  permissions: ["pos.order.create", "pos.order.view"],
  assignedUserCount: 3,
};

const HEAD_WAITER = {
  code: "HEAD_WAITER",
  name: "Head Waiter",
  system: false,
  permissions: ["pos.order.create", "pos.order.view"],
  assignedUserCount: 1,
};

function mockCatalogue(roles: unknown[] = [CASHIER], warnings: unknown[] = []) {
  server.use(
    http.get("*/api/v1/roles", () => HttpResponse.json({ data: roles, meta: null, warnings })),
    http.get("*/api/v1/permissions", () =>
      HttpResponse.json({ data: CATALOGUE, meta: null, warnings: [] }),
    ),
  );
}

/** OWNER's real shape: holds everything in the fixture catalogue. */
const OWNER_PERMISSIONS = [
  "rbac.manage",
  "rbac.role.manage",
  "rbac.user.manage",
  "pos.order.create",
  "pos.order.view",
  "pos.order.void.any",
];

/** TENANT_ADMIN's real shape: everything EXCEPT `rbac.manage` (13-02's authority split). */
const TENANT_ADMIN_PERMISSIONS = OWNER_PERMISSIONS.filter((code) => code !== "rbac.manage");

function renderPage(permissions: string[] = OWNER_PERMISSIONS) {
  seedSession({ permissions, branchId: BRANCH, tenantId: TENANT });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <RolesPage />
    </Wrapper>,
  );
}

describe("Roles screen", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("is reachable from the sidebar by the roles that administer people", () => {
    const entry = navGroups.flatMap((g) => g.items).find((item) => item.href === "/app/roles");
    expect(entry, "no sidebar entry points at /app/roles").toBeDefined();
    expect(entry?.comingSoon).toBeFalsy();
    // `any`, not `all`. TENANT_ADMIN deliberately does not hold `rbac.manage` (13-02), and a nav
    // entry requiring every code would hide this screen from a role that exists to use it.
    expect(entry?.permissionMode).toBe("any");
    expect(entry?.permission).toEqual(
      expect.arrayContaining(["rbac.manage", "rbac.user.manage", "rbac.role.manage"]),
    );
  });

  it("lists the roles with how much authority each carries and how many people hold it", async () => {
    mockCatalogue([CASHIER, HEAD_WAITER]);
    renderPage();

    const list = await screen.findByTestId("role-list");
    expect(within(list).getByText("Cashier")).toBeInTheDocument();
    expect(within(list).getByText("Head Waiter")).toBeInTheDocument();
    expect(within(list).getByText("CASHIER")).toBeInTheDocument();
    // "2 permissions · 3 people" — the two facts an admin needs before touching a role.
    expect(within(list).getAllByText(/permissions/).length).toBeGreaterThan(0);
    expect(within(list).getByText("3")).toBeInTheDocument();
    expect(within(list).getByText("Built-in")).toBeInTheDocument();
    expect(within(list).getByText("Custom")).toBeInTheDocument();
  });

  /**
   * The register's headline finding, inverted into an assertion: opening a BUILT-IN role and
   * reading every permission it grants, under its module heading.
   */
  it("shows what the built-in Cashier role grants, grouped by module", async () => {
    mockCatalogue();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /see what Cashier grants/i }));

    const view = await screen.findByTestId("role-permission-view");
    expect(within(view).getByRole("heading", { name: "pos" })).toBeInTheDocument();
    expect(within(view).getByText("pos.order.create")).toBeInTheDocument();
    expect(within(view).getByText("pos.order.view")).toBeInTheDocument();
    expect(within(view).getByText("Create POS orders")).toBeInTheDocument();
    // What it does NOT grant must be absent, or "shows the permissions" is satisfied by a
    // component that lists the whole catalogue.
    expect(within(view).queryByText("pos.order.void.any")).not.toBeInTheDocument();
    expect(within(view).queryByRole("heading", { name: "rbac" })).not.toBeInTheDocument();
    // A built-in role is not editable, and the dialog says so rather than offering a dead button.
    expect(screen.queryByRole("button", { name: /edit permissions/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/cannot be changed/i)).toBeInTheDocument();
  });

  it("composes a new role from ticked permissions and sends exactly what was ticked", async () => {
    mockCatalogue();
    const sent: unknown[] = [];
    server.use(
      http.post("*/api/v1/roles", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(
          {
            data: {
              code: "HEAD_WAITER",
              name: "Head Waiter",
              system: false,
              permissions: ["pos.order.create", "pos.order.view"],
              assignedUserCount: 0,
            },
            meta: null,
            warnings: [],
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText(/role name/i), "Head Waiter");
    await user.click(await screen.findByLabelText(/pos\.order\.create/i));
    await user.click(screen.getByLabelText(/pos\.order\.view/i));

    expect(screen.getByTestId("permission-count")).toHaveTextContent("2 of 5 selected");

    await user.click(screen.getByRole("button", { name: /create role/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      name: "Head Waiter",
      permissions: ["pos.order.create", "pos.order.view"],
    });
  });

  it("names the field and the real problem while the administrator types", async () => {
    mockCatalogue();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /new role/i }));

    // Nothing ticked yet: the permissions error is live before any submit.
    expect(screen.getByText(/tick at least one permission/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create role/i })).toBeDisabled();

    const name = screen.getByLabelText(/role name/i);
    await user.type(name, "H");
    await user.tab();
    expect(await screen.findByText(/name is too short/i)).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    await user.type(name, "ead Waiter");
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "false"));
    await user.click(screen.getByLabelText(/pos\.order\.view/i));
    await waitFor(() => expect(screen.getByRole("button", { name: /create role/i })).toBeEnabled());
  });

  /**
   * The ceiling, at the UI and then at the server.
   *
   * <p>A TENANT_ADMIN does not hold `rbac.manage`. The picker marks it, the form warns before the
   * request leaves, and the server's own 403 sentence is rendered on the form afterwards. The
   * warning is not a substitute for the refusal — a token is a snapshot, and blocking on it would
   * refuse writes the server would allow. Both halves are asserted.
   */
  it("warns a tenant admin about permissions beyond their authority, then shows the server's refusal", async () => {
    mockCatalogue();
    server.use(
      http.post("*/api/v1/roles", () =>
        HttpResponse.json(
          {
            error: {
              code: "ROLE_CEILING_EXCEEDED",
              message:
                "You cannot create a role carrying 1 permission(s) you do not hold yourself. A role can only grant what its author can already do.",
              traceId: "t",
            },
          },
          { status: 403 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage(TENANT_ADMIN_PERMISSIONS);

    await user.click(await screen.findByRole("button", { name: /new role/i }));
    await user.type(screen.getByLabelText(/role name/i), "Shadow Owner");
    await user.click(await screen.findByLabelText(/rbac\.manage/i));

    // The picker itself marks the code the caller does not hold.
    expect(screen.getAllByText(/you don’t hold this/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/beyond your own authority/i)).toBeInTheDocument();

    // Still submittable — the server is the authority, not the token.
    const save = screen.getByRole("button", { name: /create role/i });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(await screen.findByText(/you do not hold yourself/i)).toBeInTheDocument();
  });

  it("refuses to promise a deletion the server will refuse, and says who is in the way", async () => {
    mockCatalogue([CASHIER, HEAD_WAITER]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /delete Head Waiter/i }));
    expect(await screen.findByText(/1 person holds this role/i)).toBeInTheDocument();
    expect(screen.getByText(/move them to another role/i)).toBeInTheDocument();
  });

  it("surfaces the ceiling's own report when roles were withheld", async () => {
    mockCatalogue(
      [CASHIER],
      [
        {
          code: "ROLES_WITHHELD_ABOVE_CEILING",
          message:
            "1 role(s) were withheld because they grant permissions you do not hold and therefore cannot assign",
        },
      ],
    );
    renderPage(TENANT_ADMIN_PERMISSIONS);

    expect(await screen.findByText(/1 role\(s\) were withheld/i)).toBeInTheDocument();
  });

  /**
   * GA-001: a failed read must never be rendered as "you have no roles". The product told owners
   * their business had no vendors for exactly this reason on eleven screens.
   */
  it("says the read failed rather than showing an empty catalogue", async () => {
    server.use(
      http.get("*/api/v1/roles", () =>
        HttpResponse.json({ error: { code: "X" } }, { status: 500 }),
      ),
      http.get("*/api/v1/permissions", () =>
        HttpResponse.json({ data: CATALOGUE, meta: null, warnings: [] }),
      ),
    );
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/roles in this restaurant/i);
    expect(screen.queryByText(/no roles you can administer/i)).not.toBeInTheDocument();
  });

  it("gives a cashier an explanation instead of a builder", async () => {
    mockCatalogue();
    renderPage(["pos.order.create"]);

    expect(await screen.findByText(/you don't administer roles/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new role/i })).not.toBeInTheDocument();
  });

  it("hides the write controls from a reader who may not grant roles", async () => {
    mockCatalogue([CASHIER, HEAD_WAITER]);
    renderPage(["rbac.user.manage", "pos.order.view"]);

    // The catalogue is readable — that is the whole point of the split gate.
    expect(await screen.findByText("Head Waiter")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit Head Waiter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete Head Waiter/i })).not.toBeInTheDocument();
  });
});

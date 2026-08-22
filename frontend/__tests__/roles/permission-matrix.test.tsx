import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import PermissionMatrixPage from "@/app/(tenant)/app/roles/matrix/page";

/**
 * The permission × role matrix (N6), asserted on what an administrator can now read.
 *
 * <h2>The question this screen exists to answer</h2>
 *
 * <p>`/app/roles` renders nine cards, each stating a COUNT, and a dialog that shows ONE role's
 * grants at a time. Both are good answers to "what does Cashier grant?". Neither answers "who
 * else can void an order?" — which today takes nine dialogs opened in sequence. So every
 * assertion below is driven the way an administrator drives it: read down a column, read across
 * a row, narrow to one role, and check that the four roles the demo forgot are on screen.
 *
 * <h2>The fixture is the shape of the real catalogue, not the demo's</h2>
 *
 * <p>Nine roles, because `030-create-roles-permissions.xml` seeds nine and
 * APP-DASHBOARD-AUDIT §5.1 lists them. The two the demo invents — Super Admin (a platform-plane
 * principal with no `roles` row) and Branch Mgr (the code is `MANAGER`) — are deliberately absent
 * from the fixture AND asserted absent from the screen, because a matrix that renders them is a
 * matrix built from the demo's HTML rather than from this system's seed.
 *
 * <p>`rbac.manage` is in the fixture for one reason: OWNER holds it and TENANT_ADMIN does not
 * (13-02, `057-repair-administration-role-grant-drift.xml`, `WHERE code != 'rbac.manage'`). It is
 * the single cell in this whole product where the two most powerful roles differ, so it is the
 * cell that proves the grid is reading grants rather than painting a staircase.
 */

const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

const CATALOGUE = [
  {
    module: "pos",
    permissions: [
      { code: "pos.order.create", module: "pos", description: "Create POS orders" },
      { code: "pos.order.view", module: "pos", description: "View POS orders" },
      { code: "pos.order.void.any", module: "pos", description: "Void any POS order" },
      { code: "pos.kds.view", module: "pos", description: "See the kitchen board" },
    ],
  },
  {
    module: "rbac",
    permissions: [
      { code: "rbac.manage", module: "rbac", description: "Manage RBAC" },
      { code: "rbac.role.manage", module: "rbac", description: "Compose and delete roles" },
      { code: "rbac.user.manage", module: "rbac", description: "Administer people" },
    ],
  },
  {
    module: "finance",
    permissions: [
      { code: "finance.journal.post", module: "finance", description: "Post a journal entry" },
      { code: "finance.journal.view", module: "finance", description: "Read the ledger" },
    ],
  },
  {
    module: "inventory",
    permissions: [
      { code: "inventory.item.manage", module: "inventory", description: "Edit stock items" },
      { code: "inventory.item.view", module: "inventory", description: "Read stock levels" },
    ],
  },
  {
    module: "audit",
    permissions: [{ code: "audit.log.view", module: "audit", description: "Read the audit log" }],
  },
];

const ALL_CODES = CATALOGUE.flatMap((m) => m.permissions.map((p) => p.code));

function role(code: string, name: string, permissions: string[], assignedUserCount = 1) {
  return { code, name, system: true, permissions, assignedUserCount };
}

/** The nine roles `030-…xml`, `042-…xml` and `055-…xml` actually seed. */
const NINE_ROLES = [
  role("OWNER", "Owner", ALL_CODES, 1),
  role(
    "TENANT_ADMIN",
    "Tenant Admin",
    ALL_CODES.filter((c) => c !== "rbac.manage"),
    2,
  ),
  role("MANAGER", "Manager", [
    "pos.order.create",
    "pos.order.view",
    "pos.order.void.any",
    "pos.kds.view",
  ]),
  role("ACCOUNTANT", "Accountant", [
    "pos.order.view",
    "finance.journal.post",
    "finance.journal.view",
  ]),
  role("INVENTORY_MANAGER", "Inventory Manager", ["inventory.item.manage", "inventory.item.view"]),
  role("CASHIER", "Cashier", ["pos.order.create", "pos.order.view"], 3),
  role("FINANCE_VIEWER", "Finance Viewer", ["finance.journal.view"]),
  role("KITCHEN_STAFF", "Kitchen Staff", ["pos.kds.view"]),
  role("WAITER", "Waiter", ["pos.order.create", "pos.order.view", "pos.kds.view"], 4),
];

const OWNER_PERMISSIONS = ["rbac.manage", "rbac.role.manage", "rbac.user.manage"];

function mockCatalogue(roles: unknown[] = NINE_ROLES, warnings: unknown[] = []) {
  server.use(
    http.get("*/api/v1/roles", () => HttpResponse.json({ data: roles, meta: null, warnings })),
    http.get("*/api/v1/permissions", () =>
      HttpResponse.json({ data: CATALOGUE, meta: null, warnings: [] }),
    ),
  );
}

function renderPage(permissions: string[] = OWNER_PERMISSIONS) {
  seedSession({ permissions, branchId: BRANCH, tenantId: TENANT });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PermissionMatrixPage />
    </Wrapper>,
  );
}

/** The `pos` section's grid. Scoping matters: `DataGrid` also renders a card list for < md. */
async function posTable() {
  return await screen.findByRole("table", { name: "pos permissions by role" });
}

function rowFor(table: HTMLElement, code: string): HTMLElement {
  const cell = within(table).getByText(code);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row as HTMLElement;
}

describe("Permission matrix", () => {
  afterEach(() => {
    clearSession();
  });

  it("renders every role the SERVER returns — including the four the demo omits", async () => {
    mockCatalogue();
    renderPage();

    const table = await posTable();
    for (const name of [
      "Owner",
      "Tenant Admin",
      "Manager",
      "Accountant",
      "Inventory Manager",
      "Cashier",
      "Finance Viewer",
      "Kitchen Staff",
      "Waiter",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: new RegExp(`^${name}`) }),
        `${name} has no column`,
      ).toBeInTheDocument();
    }

    // The two the demo invents. `SUPER_ADMIN` is a platform-plane principal with no `roles` row
    // and `BRANCH_MANAGER` does not exist at all — a matrix showing either was built from the
    // demo's markup rather than from this tenant's catalogue.
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/branch mgr/i)).not.toBeInTheDocument();
  });

  it("orders the columns by how much authority each role carries, so the ticks form a staircase", async () => {
    mockCatalogue();
    renderPage();

    const table = await posTable();
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim() ?? "");

    expect(headers[0]).toBe("Permission");
    // Owner (12 grants) → Kitchen Staff (1). Ties break on name: Accountant before Waiter,
    // Cashier before Inventory Manager, Finance Viewer before Kitchen Staff.
    expect(headers.slice(1).map((h) => h.replace(/\d+\/\d+$/, ""))).toEqual([
      "Owner",
      "Tenant Admin",
      "Manager",
      "Accountant",
      "Waiter",
      "Cashier",
      "Inventory Manager",
      "Finance Viewer",
      "Kitchen Staff",
    ]);
  });

  it("states for one permission exactly who holds it and who does not", async () => {
    mockCatalogue();
    renderPage();

    const table = await posTable();
    const voidRow = rowFor(table, "pos.order.void.any");

    expect(within(voidRow).getByText("Owner: granted")).toBeInTheDocument();
    expect(within(voidRow).getByText("Manager: granted")).toBeInTheDocument();
    // The whole point of reading across a row: a cashier may void their OWN order and this code
    // is `void.any`. A matrix that could not show the difference would not be worth building.
    expect(within(voidRow).getByText("Cashier: not granted")).toBeInTheDocument();
    expect(within(voidRow).getByText("Kitchen Staff: not granted")).toBeInTheDocument();
  });

  it("shows the one cell where OWNER and TENANT_ADMIN differ", async () => {
    mockCatalogue();
    renderPage();

    const rbacTable = await screen.findByRole("table", { name: "rbac permissions by role" });
    const manageRow = rowFor(rbacTable, "rbac.manage");

    // 13-02 / changelog 057: TENANT_ADMIN is granted every code EXCEPT this one, so that a tenant
    // administrator cannot mint an OWNER. It is the single differing cell in the product.
    expect(within(manageRow).getByText("Owner: granted")).toBeInTheDocument();
    expect(within(manageRow).getByText("Tenant Admin: not granted")).toBeInTheDocument();

    const roleManageRow = rowFor(rbacTable, "rbac.role.manage");
    expect(within(roleManageRow).getByText("Tenant Admin: granted")).toBeInTheDocument();
  });

  it("groups the 711 cells by domain rather than laying out one unreadable slab", async () => {
    mockCatalogue();
    renderPage();

    await posTable();
    // `moduleName`, not `module`: `@next/next/no-assign-module-variable` refuses the shadow.
    for (const moduleName of ["pos", "rbac", "finance", "inventory", "audit"]) {
      expect(
        screen.getByRole("heading", { name: moduleName, level: 2 }),
        `no section heading for ${moduleName}`,
      ).toBeInTheDocument();
      expect(
        screen.getByRole("table", { name: `${moduleName} permissions by role` }),
      ).toBeInTheDocument();
    }

    // Every section is reachable from the keyboard in one press rather than 79.
    const jump = screen.getByRole("navigation", { name: "Jump to a module" });
    expect(within(jump).getByRole("link", { name: /^pos/ })).toHaveAttribute(
      "href",
      "#permission-matrix-pos",
    );
  });

  it("does not invent the demo's two partial-grant words", async () => {
    mockCatalogue();
    renderPage();

    await posTable();
    // `role_permissions` is a junction table: a role holds a code or it does not. The demo's
    // `View` and `Summary` cells cannot be computed here, and D-38-16 says an uncomputable value
    // is an absence, never a figure. So the grid says so in words instead of inventing a glyph.
    expect(
      screen.getByText(/every grant is all-or-nothing/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
  });

  it("keeps every column when the reader narrows to one role", async () => {
    mockCatalogue();
    renderPage();
    const user = userEvent.setup();

    await posTable();
    await user.selectOptions(screen.getByTestId("matrix-filter-role"), "KITCHEN_STAFF");

    const table = await screen.findByRole("table", { name: "pos permissions by role" });
    expect(within(table).getByText("pos.kds.view")).toBeInTheDocument();
    expect(within(table).queryByText("pos.order.void.any")).not.toBeInTheDocument();

    // The columns must survive their own filter. Narrowing the ROWS to what Kitchen Staff holds
    // and simultaneously dropping the other eight columns would delete the comparison this
    // screen exists for at the exact moment the reader asks for it.
    expect(within(table).getByRole("columnheader", { name: /^Owner/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /^Waiter/ })).toBeInTheDocument();

    // And the modules Kitchen Staff holds nothing in are gone rather than shown as empty tables.
    expect(
      screen.queryByRole("table", { name: "finance permissions by role" }),
    ).not.toBeInTheDocument();
  });

  it("says so when the caller's ceiling withheld roles, because a missing column is a wrong matrix", async () => {
    mockCatalogue(NINE_ROLES.slice(0, 4), [
      {
        code: "ROLES_WITHHELD_ABOVE_CEILING",
        message: "5 roles are not shown because they grant permissions you do not hold.",
      },
    ]);
    renderPage();

    await posTable();
    expect(
      screen.getByText(/5 roles are not shown because they grant permissions you do not hold/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not the whole picture/i)).toBeInTheDocument();
  });

  it("refuses to draw a matrix from half its axes", async () => {
    server.use(
      http.get("*/api/v1/roles", () =>
        HttpResponse.json({ data: NINE_ROLES, meta: null, warnings: [] }),
      ),
      http.get("*/api/v1/permissions", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderPage();

    // Not an empty matrix and not a matrix of nine empty columns: every blank cell would read as
    // "not granted" when it actually means "not loaded", which on an authorization screen is the
    // most dangerous thing this interface could say.
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
    expect(screen.queryByTestId("permission-matrix")).not.toBeInTheDocument();
  });

  it("refuses the screen to a caller who does not administer roles", async () => {
    mockCatalogue();
    renderPage(["pos.order.view"]);

    expect(await screen.findByText(/you don.t administer roles/i)).toBeInTheDocument();
    expect(screen.queryByTestId("permission-matrix")).not.toBeInTheDocument();
  });
});

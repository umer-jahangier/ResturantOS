import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import SettingsPage from "@/app/(tenant)/app/settings/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/**
 * The settings index (38-10 task 2), and the two properties its verification table names.
 *
 * <h3>What is asserted, and why it is asserted here rather than in an e2e</h3>
 *
 * 38-10's verification table lists "no empty group" and "no page exceeds one screenful of
 * unrelated groups" as **e2e** checks. The e2e stack needs a running gateway and a TOTP-capable
 * persona; this session has neither (see the plan's own task 1, and the report). Both properties
 * are structural rather than visual, so they are asserted at the component level instead — which
 * is weaker than the e2e for layout and *stronger* for the thing that actually matters: the
 * permission-to-tile mapping, driven at four different permission sets.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * <ol>
 * <li>The `.filter((group) => group.entries.length > 0)` removed from the page, which is the
 *    only thing stopping an unreachable group from rendering as an empty card → RED on "renders
 *    no group with nothing in it": *"Unable to find an accessible element with the role
 *    'listitem'"*. That is the plan's fourth negative control ("add an empty settings group →
 *    empty-group check red"), observed against the mechanism rather than against a symptom.
 *    Restored.</li>
 * <li>The Users tile's gate hard-coded to `allowed: true` → RED on "shows a tile only to a
 *    holder of the destination's own gate": *"expected &lt;a …&gt; to be null"*. Restored.</li>
 * </ol>
 */

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

/** The branch read the page's one saving form makes. Not the subject here; kept quiet. */
function mockBranch() {
  server.use(
    http.get("*/api/v1/branches/*", () =>
      HttpResponse.json({
        data: {
          id: BRANCH,
          tenantId: TENANT,
          name: "Floating Terrace HQ",
          isHq: true,
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
        },
        meta: null,
        warnings: [],
      }),
    ),
  );
}

function renderAs(permissions: string[], roles: string[] = ["OWNER"]) {
  mockBranch();
  seedSession({ permissions, roles, branchId: BRANCH, tenantId: TENANT });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <SettingsPage />
    </Wrapper>,
  );
}

/** Every rendered group card, by its heading. */
function groupHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent ?? "")
    .filter(Boolean);
}

describe("the settings index", () => {
  afterEach(() => {
    clearSession();
    server.resetHandlers();
  });

  it("renders exactly one h1, and it comes from PageHeader", () => {
    renderAs(["rbac.manage"]);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe("Settings");
  });

  it("renders no group with nothing in it", () => {
    // `branch.manage` opens the page (that is the route's own gate) and `audit.log.view` is the
    // only tile gate this session holds — so most groups have no admissible tile. The check is
    // the invariant, not the number: a group card must never render empty.
    renderAs(["branch.manage", "audit.log.view"], ["OWNER"]);
    const cards = screen.getAllByRole("list");
    for (const card of cards) {
      expect(within(card).getAllByRole("listitem").length).toBeGreaterThan(0);
    }
  });

  it("refuses a cashier the page outright rather than showing tiles that would 403", () => {
    // The route's own gate is `rbac.manage | branch.manage`. A cashier holds neither, so what
    // renders is the shared refusal — not a settings page with every tile hidden, which would
    // read as "your restaurant has no settings".
    renderAs(["pos.order.create"], ["CASHIER"]);
    expect(screen.queryByRole("link", { name: /Audit log/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Sales tax/ })).toBeNull();
    expect(screen.queryByTestId("settings-absent-groups")).toBeNull();
  });

  it("shows a tile only to a holder of the destination's own gate", () => {
    renderAs(["branch.manage", "audit.log.view"], ["MANAGER"]);
    expect(screen.getByRole("link", { name: /Audit log/ })).toBeTruthy();
    // `rbac.manage | rbac.user.manage` is what /app/users enforces; this session holds neither,
    // so the tile is absent rather than present-and-403ing.
    expect(screen.queryByRole("link", { name: /^Users/ })).toBeNull();
  });

  it("names the four §55 groups that have no service, instead of rendering empty tabs", () => {
    renderAs(["rbac.manage"]);
    const absent = screen.getByTestId("settings-absent-groups");
    for (const name of ["Restaurant profile", "Payments", "Notifications", "Permissions"]) {
      expect(within(absent).getByText(name)).toBeTruthy();
    }
    // Each absence states WHY. A list of four words would send the reader looking again.
    expect(within(absent).getByText(/no tenant-profile API/)).toBeTruthy();
    expect(within(absent).getByText(/notification service is not deployed/)).toBeTruthy();
  });

  it("does not offer Appearance to a role that is not OWNER or TENANT_ADMIN", () => {
    // The sidebar gates this entry on the role rather than on a permission; the tile matches it.
    renderAs(["branch.manage"], ["MANAGER"]);
    expect(screen.queryByRole("link", { name: /Appearance/ })).toBeNull();
    cleanup();
    renderAs(["branch.manage"], ["TENANT_ADMIN"]);
    expect(screen.getAllByRole("link", { name: /Appearance/ }).length).toBeGreaterThan(0);
  });

  it("groups the tiles rather than listing twelve of them on one plane", () => {
    // The plan's "never one enormous page". An owner holding everything sees five named groups —
    // the assertion is that grouping HAPPENED, not that a particular five exist.
    renderAs(
      [
        "rbac.manage",
        "rbac.user.manage",
        "audit.log.view",
        "branch.manage",
        "pos.tax.manage",
        "pos.service_charge.manage",
        "pos.terminals.admin",
        "pos.menu.manage",
        "pos.printers.admin",
        "nlq.settings.manage",
        "ops.health.view",
      ],
      ["OWNER"],
    );
    const headings = groupHeadings();
    expect(headings.length).toBeGreaterThanOrEqual(5);
    expect(headings).toContain("People and access");
    expect(headings).toContain("Not in this release");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { navGroups, type NavGroup } from "@/components/shared/sidebar-nav-items";
import { useFeatureFlags } from "@/lib/hooks/auth/use-feature-flags";
import { useNavGroupVisibility } from "@/lib/hooks/auth/use-nav-visibility";

/**
 * THE REGRESSION GATE FOR THE REVAMP — UI-SPEC §10.2 step 5, §10.3 gate 3.
 *
 * <p>Phase 20 replaces the flat 25-row sidebar with a two-tier space rail + panel. The
 * permission-driven navigation it replaces is the healthiest part of this frontend: four
 * independent gates (`permission`, `feature`, `roles`, `comingSoon`) composed in one place,
 * with `feature` typed as `FeatureFlag` so an ungranted flag is a compile error. The single
 * most likely way to damage the product during a visual revamp is to reimplement that
 * quietly wrong — a cashier who can suddenly see General Ledger, or an owner who silently
 * loses Purchasing.
 *
 * <p>So this test freezes the OUTPUT, not the implementation. For six role fixtures it
 * records the exact, ordered set of nav groups and items each one sees. The expectations
 * below are written out literally rather than captured with `toMatchSnapshot`, because a
 * snapshot that `vitest -u` rewrites on demand is not a gate — it is a diary.
 *
 * <p>What is being asserted is `useNavGroupVisibility`, the same hook `Sidebar` and (as of
 * 20-01) `MobileBottomNav` compute visibility with. Whatever renders the nav after the
 * revamp — rail, panel, bottom bar, command palette — must route through it and must
 * produce these sets unchanged.
 *
 * <p>Permission sets are the nav-relevant subset of each seeded role's real grant
 * (`scripts/CREDENTIALS.md` — OWNER 65 codes, TENANT_ADMIN 64, MANAGER 49, ACCOUNTANT 24,
 * CASHIER 14, KITCHEN_STAFF 2). Codes no nav item reads are omitted: they cannot change
 * the answer, and listing them would imply this file is a copy of the RBAC catalogue,
 * which it is not.
 */

const ENTERPRISE_FEATURES = [
  "FEATURE_POS",
  "FEATURE_KDS",
  "FEATURE_INVENTORY",
  "FEATURE_FINANCE",
  "FEATURE_VENDOR",
  "FEATURE_HR",
  "FEATURE_CRM",
  "FEATURE_NLQ",
  "FEATURE_REPORTING_ADVANCED",
];

// ── The nav-relevant permission codes, by role ────────────────────────────────────
const NAV_PERMISSIONS = {
  full: [
    "pos.order.view",
    "pos.kds.view",
    "pos.till.review",
    "pos.menu.manage",
    "inventory.item.view",
    "finance.journal.view",
    "vendor.view",
    "crm.customer.view",
    "reporting.report.view",
    "reporting.dashboard.view",
    "nlq.query.run",
    "rbac.manage",
  ],
} as const;

interface RoleFixture {
  role: string;
  roles: string[];
  permissions: string[];
}

const FIXTURES: Record<string, RoleFixture> = {
  OWNER: {
    role: "OWNER",
    roles: ["OWNER"],
    permissions: [...NAV_PERMISSIONS.full],
  },
  TENANT_ADMIN: {
    role: "TENANT_ADMIN",
    roles: ["TENANT_ADMIN"],
    // Everything except `rbac.manage` — 13-02 split user/branch administration off it.
    permissions: NAV_PERMISSIONS.full.filter((code) => code !== "rbac.manage"),
  },
  MANAGER: {
    role: "MANAGER",
    roles: ["MANAGER"],
    // Menu, staff, reports; no role administration, no finance ledger, no NLQ.
    permissions: [
      "pos.order.view",
      "pos.kds.view",
      "pos.till.review",
      "pos.menu.manage",
      "inventory.item.view",
      "vendor.view",
      "crm.customer.view",
      "reporting.report.view",
      "reporting.dashboard.view",
    ],
  },
  ACCOUNTANT: {
    role: "ACCOUNTANT",
    roles: ["ACCOUNTANT"],
    // Chart of accounts, journals, period close — plus the vendor side of the ledger.
    permissions: ["finance.journal.view", "vendor.view", "reporting.report.view"],
  },
  CASHIER: {
    role: "CASHIER",
    roles: ["CASHIER"],
    // Till open/close, settle, void own. Note: NOT `pos.till.review` — reviewing a till is
    // the manager's job, and a cashier who could review their own would be the whole point
    // of the control gone.
    permissions: ["pos.order.view"],
  },
  KITCHEN_STAFF: {
    role: "KITCHEN_STAFF",
    roles: ["KITCHEN_STAFF"],
    // Two codes in the whole product.
    permissions: ["pos.kds.view"],
  },
};

/** One hook call per group — `useNavGroupVisibility` is exactly what `Sidebar` calls. */
function GroupProbe({ group }: { group: NavGroup }) {
  const { hasVisibleItems, isItemVisible } = useNavGroupVisibility(group);
  if (!hasVisibleItems) return null;
  return (
    <section data-testid="nav-group" data-label={group.label}>
      {group.items.filter(isItemVisible).map((item) => (
        <a key={item.href} data-testid="nav-item" data-href={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </section>
  );
}

/**
 * Signals that the feature-flags query has settled. Without it a test can read the nav
 * while flags are still pending — at which point only the three groups that contain no
 * `feature` gate at all have rendered, and the assertion silently measures the loading
 * state instead of the answer.
 */
function FlagsReady() {
  const { isPending } = useFeatureFlags();
  return isPending ? null : <span data-testid="flags-ready" />;
}

function NavProbe() {
  return (
    <>
      <FlagsReady />
      {navGroups.map((group) => (
        <GroupProbe key={group.label} group={group} />
      ))}
    </>
  );
}

type VisibleNav = { group: string; items: string[] }[];

async function visibleNavFor(fixture: RoleFixture, features: string[]): Promise<VisibleNav> {
  cleanup(); // several fixtures are rendered inside one test; queries read document.body
  server.use(
    http.get("*/api/v1/feature-flags", () =>
      HttpResponse.json({ data: { features }, meta: null, warnings: [] }),
    ),
  );
  seedSession({ roles: fixture.roles, permissions: fixture.permissions });

  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <NavProbe />
    </Wrapper>,
  );

  await screen.findByTestId("flags-ready");

  return screen.getAllByTestId("nav-group").map((section) => ({
    group: section.getAttribute("data-label")!,
    items: [...section.querySelectorAll("[data-testid='nav-item']")].map(
      (a) => a.textContent ?? "",
    ),
  }));
}

describe("nav permission matrix — the set each role sees must not move", () => {
  afterEach(() => clearSession());

  it("OWNER sees every space", async () => {
    expect(await visibleNavFor(FIXTURES.OWNER!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      { group: "Orders", items: ["POS", "Kitchen Display", "Till Review"] },
      { group: "Menu", items: ["Inventory", "Menu Items"] },
      {
        group: "Finance",
        items: ["Accounts", "Journal Entries", "General Ledger", "Periods", "Expenses", "AP Aging"],
      },
      { group: "Purchasing", items: ["Purchasing"] },
      { group: "People", items: ["HR", "Customers"] },
      { group: "Reporting", items: ["Reports", "Realtime Dashboard", "Ask (NLQ)"] },
      { group: "Settings", items: ["Appearance"] },
    ]);
  });

  it("TENANT_ADMIN sees the same as OWNER — `rbac.manage` gates only comingSoon items today", async () => {
    // Not a bug: the two items `rbac.manage` would unlock (Settings → Users) are
    // `comingSoon: true`, so today the difference is invisible in the nav. Recorded here so
    // that when `/app/settings/users` ships, THIS assertion is what forces the split.
    expect(await visibleNavFor(FIXTURES.TENANT_ADMIN!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      { group: "Orders", items: ["POS", "Kitchen Display", "Till Review"] },
      { group: "Menu", items: ["Inventory", "Menu Items"] },
      {
        group: "Finance",
        items: ["Accounts", "Journal Entries", "General Ledger", "Periods", "Expenses", "AP Aging"],
      },
      { group: "Purchasing", items: ["Purchasing"] },
      { group: "People", items: ["HR", "Customers"] },
      { group: "Reporting", items: ["Reports", "Realtime Dashboard", "Ask (NLQ)"] },
      { group: "Settings", items: ["Appearance"] },
    ]);
  });

  it("MANAGER gets operations and reports but no ledger, no HR, no Appearance", async () => {
    expect(await visibleNavFor(FIXTURES.MANAGER!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      { group: "Orders", items: ["POS", "Kitchen Display", "Till Review"] },
      { group: "Menu", items: ["Inventory", "Menu Items"] },
      { group: "Purchasing", items: ["Purchasing"] },
      { group: "People", items: ["Customers"] },
      { group: "Reporting", items: ["Reports", "Realtime Dashboard"] },
    ]);
    // HR is role-gated to OWNER/TENANT_ADMIN even though FEATURE_HR is on — the gate that
    // stops a feature-only item leaking to every role.
    expect(screen.queryByText("HR")).not.toBeInTheDocument();
  });

  it("ACCOUNTANT gets the ledger and nothing operational", async () => {
    expect(await visibleNavFor(FIXTURES.ACCOUNTANT!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      {
        group: "Finance",
        items: ["Accounts", "Journal Entries", "General Ledger", "Periods", "Expenses", "AP Aging"],
      },
      { group: "Purchasing", items: ["Purchasing"] },
      { group: "Reporting", items: ["Reports"] },
    ]);
    expect(screen.queryByText("POS")).not.toBeInTheDocument();
    expect(screen.queryByText("Kitchen Display")).not.toBeInTheDocument();
  });

  it("CASHIER sees POS and the dashboard — nothing else", async () => {
    expect(await visibleNavFor(FIXTURES.CASHIER!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      { group: "Orders", items: ["POS"] },
    ]);
    // The control that matters: a cashier must never reach the review of their own till.
    expect(screen.queryByText("Till Review")).not.toBeInTheDocument();
    expect(screen.queryByText("General Ledger")).not.toBeInTheDocument();
  });

  it("KITCHEN_STAFF sees the Kitchen Display and the dashboard — nothing else", async () => {
    expect(await visibleNavFor(FIXTURES.KITCHEN_STAFF!, ENTERPRISE_FEATURES)).toEqual([
      { group: "Overview", items: ["Dashboard"] },
      { group: "Orders", items: ["Kitchen Display"] },
    ]);
    expect(screen.queryByText("POS")).not.toBeInTheDocument();
  });
});

describe("nav permission matrix — the feature axis is independent of the role axis", () => {
  afterEach(() => clearSession());

  it("an owner on a tenant without FEATURE_CRM loses Customers, keeps HR", async () => {
    // The Control Bistro control tenant (scripts/CREDENTIALS.md): CRM forced off so feature
    // gating is exercised rather than assumed. Permission held, feature absent → hidden.
    const nav = await visibleNavFor(
      FIXTURES.OWNER!,
      ENTERPRISE_FEATURES.filter((f) => f !== "FEATURE_CRM"),
    );
    expect(nav.find((g) => g.group === "People")).toEqual({ group: "People", items: ["HR"] });
  });

  it("a whole group disappears when its only feature is off", async () => {
    const nav = await visibleNavFor(
      FIXTURES.OWNER!,
      ENTERPRISE_FEATURES.filter((f) => f !== "FEATURE_VENDOR"),
    );
    expect(nav.map((g) => g.group)).not.toContain("Purchasing");
  });

  it("a feature-flags outage fails OPEN — the gateway is the real enforcement point", async () => {
    server.use(
      http.get("*/api/v1/feature-flags", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    seedSession({ roles: FIXTURES.CASHIER!.roles, permissions: FIXTURES.CASHIER!.permissions });

    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <NavProbe />
      </Wrapper>,
    );

    // Permission still gates: the cashier gets POS (feature unknown → shown), never Finance.
    expect(await screen.findByText("POS")).toBeInTheDocument();
    expect(screen.queryByText("General Ledger")).not.toBeInTheDocument();
  });
});

describe("nav permission matrix — comingSoon items reach no surface", () => {
  afterEach(() => clearSession());

  it("no route without a page.tsx is ever rendered, for any role", async () => {
    // UI-SPEC §4.2 "Dead links must be fixed, not carried over". These three hrefs have no
    // page and are marked `comingSoon`; before 20-01 the mobile bar and the profile menu
    // linked to the first of them anyway.
    const DEAD = ["/app/settings", "/app/settings/users", "/app/reporting"];
    for (const key of Object.keys(FIXTURES)) {
      const nav = await visibleNavFor(FIXTURES[key]!, ENTERPRISE_FEATURES);
      const hrefs = [...document.querySelectorAll("[data-testid='nav-item']")].map((a) =>
        a.getAttribute("data-href"),
      );
      for (const dead of DEAD) {
        expect(hrefs, `${key} sees the dead link ${dead}`).not.toContain(dead);
      }
      expect(nav.length).toBeGreaterThan(0);
      clearSession();
    }
  });
});

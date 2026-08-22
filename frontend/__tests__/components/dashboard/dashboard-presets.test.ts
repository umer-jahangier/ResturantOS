import { describe, it, expect } from "vitest";

import {
  DASHBOARD_PRESETS,
  resolveDashboardPreset,
  visiblePortlets,
} from "@/components/dashboard/presets";

/**
 * dashboard-presets.test.ts — the assertion that "owner and manager get different pages"
 * is a fact about the code, not a claim in a summary.
 *
 * Before phase 21 every role got the same four stat cards, and no test could have caught
 * that, because there was nothing to compare — the difference lived (or did not) inside JSX
 * branches. Shipping the layout as DATA is what makes it assertable, and this file is the
 * reason that trade is worth making.
 */

const OWNER_PERMS = [
  "reporting.report.view",
  "reporting.dashboard.view",
  "pos.order.view",
  "pos.kds.view",
  "pos.till.review",
  "pos.menu.view",
];
const MANAGER_PERMS = [
  "pos.order.view",
  "pos.kds.view",
  "pos.till.review",
  "pos.menu.view",
  "reporting.dashboard.view",
  "reporting.report.view",
];
const KITCHEN_PERMS = ["pos.kds.view", "pos.kds.update"];
const CASHIER_PERMS = ["pos.order.view", "pos.till.open"];

describe("resolveDashboardPreset", () => {
  it("routes each seeded role to its own preset", () => {
    expect(resolveDashboardPreset(["OWNER"], OWNER_PERMS)).toBe("owner");
    expect(resolveDashboardPreset(["MANAGER"], MANAGER_PERMS)).toBe("manager");
    expect(resolveDashboardPreset(["KITCHEN_STAFF"], KITCHEN_PERMS)).toBe("kitchen");
    expect(resolveDashboardPreset(["CASHIER"], CASHIER_PERMS)).toBe("cashier");
  });

  /**
   * A WAITER used to land here — and this assertion used to REQUIRE it.
   *
   * <p>That is the part worth recording. `resolveDashboardPreset(["WAITER"], …) === "cashier"`
   * was a passing test asserting a defect: a waiter holds no `pos.till.open`, so `cashier-till`
   * was filtered straight back out and the page opened with the question *"Where is my till, and
   * what is still open?"* over a page that had declined to answer the till half of it. The test
   * proved the routing was intentional; it could not notice that the intention was wrong.
   * Phase 38 gives the role its own preset. `role-dashboards.test.tsx` covers all nine.
   */
  it("gives a waiter their own preset rather than a cashier's, minus the till", () => {
    expect(resolveDashboardPreset(["WAITER"], CASHIER_PERMS)).toBe("waiter");
  });

  it("gives an accountant their own preset rather than the owner's question", () => {
    // ACCOUNTANT holds `reporting.report.view`, so before phase 38 it fell past every role
    // match and was caught by the permission fallback below — which routes to `owner`.
    expect(resolveDashboardPreset(["ACCOUNTANT"], OWNER_PERMS)).toBe("accountant");
  });

  it("gives the two roles that used to see NO numbers a dashboard of their own", () => {
    expect(resolveDashboardPreset(["INVENTORY_MANAGER"], ["inventory.item.view"])).toBe(
      "inventory",
    );
    expect(resolveDashboardPreset(["FINANCE_VIEWER"], ["finance.journal.view"])).toBe("finance");
  });

  it("gives a tenant admin the owner view — they answer the same question", () => {
    expect(resolveDashboardPreset(["TENANT_ADMIN"], OWNER_PERMS)).toBe("owner");
  });

  it("never throws on an unknown role and never returns nothing (Registry Safety)", () => {
    expect(resolveDashboardPreset(["SOMETHING_NEW"], KITCHEN_PERMS)).toBe("kitchen");
    expect(resolveDashboardPreset([], [])).toBe("cashier");
    expect(resolveDashboardPreset(["SOMETHING_NEW"], OWNER_PERMS)).toBe("owner");
  });

  it("is case-insensitive about the role name", () => {
    expect(resolveDashboardPreset(["owner"], OWNER_PERMS)).toBe("owner");
  });
});

describe("owner and manager are genuinely different dashboards", () => {
  const owner = DASHBOARD_PRESETS.owner;
  const manager = DASHBOARD_PRESETS.manager;

  it("differ in their FIRST ROW — the thing each role sees first", () => {
    const firstRow = (preset: typeof owner) =>
      preset.portlets.filter((p) => p.row === 1).map((p) => p.title);

    expect(firstRow(owner)).not.toEqual(firstRow(manager));
    // §7.3: owner opens on money, manager opens on what needs them now.
    expect(firstRow(owner)[0]).toBe("Net sales");
    expect(firstRow(manager)[0]).toBe("Open orders");
  });

  it("do not merely relabel the same portlet ids", () => {
    const ownerIds = new Set(owner.portlets.map((p) => p.id));
    const managerIds = new Set(manager.portlets.map((p) => p.id));
    const shared = [...ownerIds].filter((id) => managerIds.has(id));

    expect(shared).toHaveLength(0);
  });

  it("read different time frames — an owner reads periods, a manager reads now", () => {
    expect(manager.timeFrame.toLowerCase()).toContain("today");
    expect(owner.timeFrame.toLowerCase()).not.toContain("today");
  });

  it("use different densities — a manager scans, an owner reads (§7.3)", () => {
    expect(owner.density).toBe("comfortable");
    expect(manager.density).toBe("compact");
  });

  it("keeps net sales off the manager's page entirely", () => {
    expect(manager.portlets.some((p) => /net sales|margin/i.test(p.title))).toBe(false);
  });

  it("keeps late tickets off the owner's page entirely", () => {
    expect(owner.portlets.some((p) => /late ticket/i.test(p.title))).toBe(false);
  });
});

describe("every portlet has a drill target — a KPI you cannot click is a poster", () => {
  it.each(Object.values(DASHBOARD_PRESETS))("$id", (preset) => {
    for (const portlet of preset.portlets) {
      expect(portlet.drillTo, `${portlet.id} has no drill target`).toMatch(/^\//);
    }
  });
});

describe("visiblePortlets — a portlet the reader cannot see is OMITTED, never errored", () => {
  it("drops the reporting portlets for a manager who lacks reporting.report.view", () => {
    const withoutReporting = MANAGER_PERMS.filter((p) => p !== "reporting.report.view");
    const visible = visiblePortlets(DASHBOARD_PRESETS.manager, withoutReporting);

    expect(visible.every((p) => p.permission !== "reporting.report.view")).toBe(true);
    // And the page is not left blank — the rest of the manager's portlets survive.
    expect(visible.length).toBeGreaterThan(3);
  });

  it("leaves a kitchen principal with exactly the two KDS portlets plus the shortcut", () => {
    const visible = visiblePortlets(DASHBOARD_PRESETS.kitchen, KITCHEN_PERMS);

    expect(visible.map((p) => p.id)).toEqual([
      "kitchen-late-tickets",
      "kitchen-open-tickets",
      "kitchen-shortcuts",
    ]);
  });

  it("shows an owner with no reporting permission nothing that needs it", () => {
    const visible = visiblePortlets(DASHBOARD_PRESETS.owner, ["pos.order.view"]);

    expect(visible.map((p) => p.id)).toEqual([
      "owner-covers",
      "owner-avg-order",
      "owner-exceptions",
    ]);
  });

  it("returns everything when the reader holds every permission", () => {
    for (const preset of Object.values(DASHBOARD_PRESETS)) {
      const allPerms = preset.portlets.flatMap((p) => (p.permission ? [p.permission] : []));
      expect(visiblePortlets(preset, allPerms)).toHaveLength(preset.portlets.length);
    }
  });
});

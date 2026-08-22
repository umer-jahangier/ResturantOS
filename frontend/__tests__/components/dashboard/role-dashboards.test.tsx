import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PortletGrid } from "@/components/dashboard/portlets/portlet-renderer";
import type { PortletModelMap } from "@/components/dashboard/portlets/portlet-renderer";
import { KpiTile } from "@/components/dashboard/portlets/portlet";
import {
  DASHBOARD_PRESETS,
  resolveDashboardPreset,
  visiblePortlets,
  type DashboardPreset,
  type DashboardPresetId,
} from "@/components/dashboard/presets";

import { FRONTEND_ROOT } from "../../lib/theme/module-graph";

/**
 * The nine seeded roles each land somewhere that answers a question they actually have — and
 * the preset table now drives the page rather than describing it.
 *
 * <h3>What was measured before this file existed</h3>
 *
 * The phase-38 audit computed `resolveDashboardPreset` then `visiblePortlets` for every real
 * role and found three wrong answers and one dead end that no test could have caught, because
 * the only assertions in `dashboard-presets.test.ts` covered the four roles that were already
 * right:
 *
 * <ul>
 *   <li>INVENTORY_MANAGER → `cashier`, and every cashier tile filtered out. <b>One</b> portlet
 *       survived — the ungated `Shortcuts` slot — so the page was a title, a time frame and a
 *       72px "Open POS" button for a POS the role holds no `pos.order.create` for.</li>
 *   <li>FINANCE_VIEWER → identical.</li>
 *   <li>ACCOUNTANT → `owner`, via the `reporting.report.view` fallback. All seven portlets
 *       rendered, which is why it survived four phases: it was not broken, it was the wrong
 *       question ("Is the business healthy?").</li>
 *   <li>WAITER → `cashier`, minus `cashier-till`, i.e. a page asking "Where is my till?" of a
 *       role that has no `pos.till.open`.</li>
 * </ul>
 *
 * <p>So the central assertion here is `NO_ROLE_LANDS_ON_A_BLANK_PAGE`: it recomputes exactly what
 * the audit computed by hand, for all nine roles, from the real seeded grant sets.
 *
 * <h3>Negative controls, each OBSERVED red then restored</h3>
 *
 * <ol>
 *   <li>The ACCOUNTANT arm removed from `resolveDashboardPreset` — which reproduces the shipped
 *       defect exactly — → the routing assertion failed with `expected 'owner' to be
 *       'accountant'`, and the role-code census failed `expected 8 to be 9`.</li>
 *   <li>The INVENTORY_MANAGER arm removed → only the census failed, and that is worth recording:
 *       the permission fallback (`inventory.item.view` → `inventory`) catches the role anyway, so
 *       the routing stays correct through a second mechanism. The census is what notices that one
 *       of the two mechanisms is gone.</li>
 *   <li>`permission` removed from `cashier-shortcuts` → the shortcuts-are-gated assertion failed.</li>
 *   <li>`row: 3` changed to `row: 1` on `owner-exceptions` → THREE assertions failed (declared
 *       set, row grouping, and the column count, which moved with the row's new size). Before
 *       phase 38 that same edit changed nothing at all, on screen or in any test.</li>
 *   <li>`kind: "RankedList"` supplied for `waiter-pass` (declared `RecordList`) → `tsc` failed
 *       with `Type '"RecordList"' is not assignable to type '"RankedList"'`; and deleting the
 *       `waiter-shortcuts` entry outright → `Property '"waiter-shortcuts"' is missing`. Those two
 *       are compile-time, so they are recorded here rather than asserted here.</li>
 * </ol>
 */

afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// The nine roles, from the auth-service Liquibase seed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The grant sets, transcribed from
 * `services/auth-service/src/main/resources/db/changelog/v1.0.0/`.
 *
 * <p>Trimmed to the permissions any dashboard portlet names — the full sets run to 79 codes for
 * OWNER and nothing here reads the other 60. Trimming is safe in ONE direction only: a portlet
 * can only be dropped by a MISSING permission, so an under-stated set can make this file report
 * a blank page that the product does not have. It cannot hide one.
 */
const SEEDED_ROLES: Record<string, string[]> = {
  // OWNER holds all 79 (`057-repair-administration-role-grant-drift.xml`).
  OWNER: [
    "reporting.report.view",
    "pos.order.view",
    "pos.kds.view",
    "pos.till.review",
    "pos.till.open",
    "pos.order.create",
    "pos.menu.view",
    "pos.tables.manage",
    "inventory.item.view",
    "vendor.view",
    "vendor.invoice.book",
    "finance.journal.view",
    "finance.ar.view",
    "hr.payroll.view",
  ],
  // TENANT_ADMIN holds all except `rbac.manage`.
  TENANT_ADMIN: [
    "reporting.report.view",
    "pos.order.view",
    "pos.kds.view",
    "pos.till.review",
    "pos.till.open",
    "pos.order.create",
    "pos.menu.view",
  ],
  MANAGER: [
    "reporting.report.view",
    "pos.order.view",
    "pos.kds.view",
    "pos.till.review",
    "pos.till.open",
    "pos.order.create",
    "pos.menu.view",
    "pos.tables.manage",
    "inventory.item.view",
    "vendor.view",
  ],
  ACCOUNTANT: [
    "finance.journal.view",
    "finance.ar.view",
    "vendor.invoice.book",
    "vendor.view",
    "reporting.report.view",
    "pos.order.view",
    "hr.payroll.view",
  ],
  INVENTORY_MANAGER: [
    "file.upload",
    "file.view",
    "inventory.item.manage",
    "inventory.item.view",
    "vendor.grn.receive",
    "vendor.po.create",
    "vendor.view",
  ],
  CASHIER: [
    "pos.menu.view",
    "pos.order.close",
    "pos.order.create",
    "pos.order.update",
    "pos.order.view",
    "pos.tables.manage",
    "pos.till.close",
    "pos.till.open",
  ],
  FINANCE_VIEWER: [
    "finance.coa.view",
    "finance.journal.post",
    "finance.journal.view",
    "hr.payroll.view",
  ],
  KITCHEN_STAFF: ["pos.kds.view", "pos.kds.update"],
  WAITER: [
    "pos.order.create",
    "pos.order.update",
    "pos.order.view",
    "pos.order.send_to_kds",
    "pos.menu.view",
    "pos.tables.manage",
    "pos.kds.view",
  ],
};

const EXPECTED_PRESET: Record<string, DashboardPresetId> = {
  OWNER: "owner",
  TENANT_ADMIN: "owner",
  MANAGER: "manager",
  ACCOUNTANT: "accountant",
  INVENTORY_MANAGER: "inventory",
  CASHIER: "cashier",
  FINANCE_VIEWER: "finance",
  KITCHEN_STAFF: "kitchen",
  WAITER: "waiter",
};

describe("every seeded role reaches a dashboard built for it", () => {
  it.each(Object.keys(SEEDED_ROLES))("%s", (role) => {
    expect(resolveDashboardPreset([role], SEEDED_ROLES[role]!)).toBe(EXPECTED_PRESET[role]);
  });

  /**
   * TWO, not three.
   *
   * <p>CASHIER and KITCHEN_STAFF are deliberately minimal — §7.3: "a cashier landing on an
   * analytics dashboard is a bug" — and each carries exactly two figure portlets plus one
   * shortcut. Raising the floor to three would fail two presets that are correct, which is how
   * a threshold gets lowered back to zero by whoever is unblocking the build. The defect this
   * measures was never "too few tiles"; it was NONE.
   */
  it("NO_ROLE_LANDS_ON_A_BLANK_PAGE — every role sees at least two portlets with figures", () => {
    const report = Object.keys(SEEDED_ROLES).map((role) => {
      const preset = DASHBOARD_PRESETS[resolveDashboardPreset([role], SEEDED_ROLES[role]!)];
      const visible = visiblePortlets(preset, SEEDED_ROLES[role]!);
      // A `Shortcuts` slot is a button, not a figure. Counting it is exactly how the audit's
      // "1 portlet" reading looked survivable on paper.
      const withFigures = visible.filter((p) => p.type !== "Shortcuts");
      return { role, preset: preset.id, visible: visible.length, withFigures: withFigures.length };
    });

    const starved = report.filter((r) => r.withFigures < 2);
    expect(
      starved,
      "a role whose dashboard renders fewer than two data portlets has been given a page " +
        "that cannot answer its own headline question. Before phase 38, INVENTORY_MANAGER and " +
        "FINANCE_VIEWER scored ZERO here and were shown a 72px Open POS button instead.\n" +
        JSON.stringify(report, null, 2),
    ).toEqual([]);
  });

  it("no role is offered a shortcut into a surface it cannot use", () => {
    for (const [role, permissions] of Object.entries(SEEDED_ROLES)) {
      const preset = DASHBOARD_PRESETS[resolveDashboardPreset([role], permissions)];
      for (const portlet of visiblePortlets(preset, permissions)) {
        if (portlet.type !== "Shortcuts") continue;
        expect(
          portlet.permission,
          `${portlet.id} is a Shortcuts slot with no permission — the exact defect that put ` +
            `"Open POS" in front of an INVENTORY_MANAGER`,
        ).toBeTruthy();
        expect(permissions).toContain(portlet.permission!);
      }
    }
  });

  it("the four provisional questions are stated as such where they are set", () => {
    // The product owner supplied five questions and not these four. The docblock beside each
    // preset is where a reader is told the difference, and where they are told to make the
    // change — so its absence is a defect in the same way a wrong question is.
    const source = readFileSync(resolve(FRONTEND_ROOT, "components/dashboard/presets.ts"), "utf8");
    for (const id of ["accountant", "inventory", "finance", "waiter"] as const) {
      expect(DASHBOARD_PRESETS[id].question).toMatch(/\?$/);
      expect(source).toContain(`question: "${DASHBOARD_PRESETS[id].question}"`);
    }
    expect(
      (source.match(/PROVISIONAL QUESTION/g) ?? []).length,
      "one marker per unsupplied question, at the preset that owns it",
    ).toBe(4);
  });

  it("keeps the questions distinct — a preset that repeats another's question is not a preset", () => {
    const questions = Object.values(DASHBOARD_PRESETS).map((p) => p.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("resolves only role codes the seed actually mints", () => {
    const source = readFileSync(resolve(FRONTEND_ROOT, "components/dashboard/presets.ts"), "utf8");
    const matched = [...source.matchAll(/has\("([A-Z_]+)"\)/g)].map((m) => m[1]!);
    expect(
      matched.filter((code) => !(code in SEEDED_ROLES)),
      "SUPER_ADMIN, BRANCH_MANAGER and KITCHEN were matched here and are minted by no " +
        "changelog. Three branches that can never be taken read as three roles that exist.",
    ).toEqual([]);
    expect(new Set(matched).size).toBe(9);
  });

  it("still falls through safely for a role nobody has heard of (Registry Safety)", () => {
    expect(resolveDashboardPreset(["SOMETHING_NEW"], [])).toBe("cashier");
    expect(resolveDashboardPreset([], [])).toBe("cashier");
    expect(resolveDashboardPreset(["SOMETHING_NEW"], ["inventory.item.view"])).toBe("inventory");
    expect(resolveDashboardPreset(["SOMETHING_NEW"], ["finance.journal.view"])).toBe("finance");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The table drives the page
// ─────────────────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [...new Set(Object.values(SEEDED_ROLES).flat())];

/** One model per portlet of the right kind, so the grid renders without any dashboard. */
function modelsFor(preset: DashboardPreset): PortletModelMap {
  const map: PortletModelMap = {};
  for (const p of preset.portlets) {
    switch (p.type) {
      case "KpiTile":
        map[p.id] = { kind: "KpiTile", value: "7", caption: "caption" };
        break;
      case "TrendChart":
        map[p.id] = { kind: "TrendChart", categories: [], series: [], emptyLabel: "none" };
        break;
      case "RankedList":
        map[p.id] = { kind: "RankedList", rows: [], emptyLabel: "none" };
        break;
      case "ExceptionList":
        map[p.id] = { kind: "ExceptionList", rows: [], emptyLabel: "none" };
        break;
      case "RecordList":
        map[p.id] = { kind: "RecordList", rows: [], emptyLabel: "none" };
        break;
      case "Shortcuts":
        map[p.id] = {
          kind: "Shortcuts",
          actions: [{ href: "/app/pos", label: "Open POS", icon: () => null }],
        };
        break;
    }
  }
  return map;
}

describe("PortletGrid — `type`, `row` and `drillTo` are read, not decorative", () => {
  it.each(Object.keys(DASHBOARD_PRESETS))(
    "%s renders every portlet its table declares, and only those",
    (id) => {
      const preset = DASHBOARD_PRESETS[id as DashboardPresetId];
      const { container } = render(
        <PortletGrid preset={preset} permissions={ALL_PERMISSIONS} models={modelsFor(preset)} />,
      );

      const rendered = [...container.querySelectorAll("[data-portlet]")].map((el) =>
        el.getAttribute("data-portlet"),
      );
      expect(rendered).toEqual(preset.portlets.map((p) => p.id));
    },
  );

  it("groups portlets into ROWS in the order the table declares them", () => {
    const preset = DASHBOARD_PRESETS.owner;
    const { container } = render(
      <PortletGrid preset={preset} permissions={ALL_PERMISSIONS} models={modelsFor(preset)} />,
    );

    const rows = [...container.querySelectorAll(".vdl-stagger")];
    const byRow = rows.map((row) =>
      [...row.querySelectorAll("[data-portlet]")].map((el) => el.getAttribute("data-portlet")),
    );

    expect(byRow).toEqual([
      ["owner-net-sales", "owner-gross-margin", "owner-covers", "owner-avg-order"],
      ["owner-sales-trend", "owner-top-items"],
      ["owner-exceptions"],
    ]);
  });

  it("takes each row's column count from the DECLARED row, not the surviving one", () => {
    const preset = DASHBOARD_PRESETS.owner;
    // A principal who cannot see reporting loses three of the four row-1 tiles.
    const { container } = render(
      <PortletGrid preset={preset} permissions={["pos.order.view"]} models={modelsFor(preset)} />,
    );

    const firstRow = container.querySelector(".vdl-stagger");
    expect(
      firstRow?.className,
      "re-flowing per principal makes the same dashboard incomparable between two readers",
    ).toContain("xl:grid-cols-4");
    expect([...firstRow!.querySelectorAll("[data-portlet]")]).toHaveLength(2);
  });

  it("gives every portlet the drill target the TABLE names", () => {
    for (const preset of Object.values(DASHBOARD_PRESETS)) {
      const { container } = render(
        <PortletGrid preset={preset} permissions={ALL_PERMISSIONS} models={modelsFor(preset)} />,
      );
      for (const spec of preset.portlets) {
        if (spec.type === "Shortcuts") continue;
        const el = container.querySelector(`[data-portlet="${spec.id}"]`);
        expect(el?.getAttribute("href"), `${spec.id} drill target`).toBe(spec.drillTo);
      }
      cleanup();
    }
  });

  it("omits a portlet whose permission the reader lacks — never an error, never an empty box", () => {
    const preset = DASHBOARD_PRESETS.inventory;
    const { container } = render(
      <PortletGrid
        preset={preset}
        permissions={["inventory.item.view"]}
        models={modelsFor(preset)}
      />,
    );

    const rendered = [...container.querySelectorAll("[data-portlet]")].map((el) =>
      el.getAttribute("data-portlet"),
    );
    // The two `vendor.view` portlets are gone; nothing anywhere says so.
    expect(rendered).not.toContain("inventory-incoming");
    expect(rendered).not.toContain("inventory-open-orders");
    expect(container.textContent).not.toMatch(/permission|denied|not allowed/i);
  });

  it("passes the stagger index down itself, because the row's clone cannot reach a portlet", () => {
    // `PortletRow` clones each child to set `--vdl-i`. Every portlet component used to swallow
    // that clone silently — none of them declared `style` — so phase 34's stagger has never run
    // on a real dashboard. The renderer now sets it directly.
    const preset = DASHBOARD_PRESETS.manager;
    const { container } = render(
      <PortletGrid preset={preset} permissions={ALL_PERMISSIONS} models={modelsFor(preset)} />,
    );

    const firstRow = container.querySelector(".vdl-stagger")!;
    const indices = [...firstRow.querySelectorAll("[data-portlet]")].map((el) =>
      (el as HTMLElement).style.getPropertyValue("--vdl-i"),
    );
    expect(indices).toEqual(["0", "1", "2", "3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-38-16 at the KpiTile
// ─────────────────────────────────────────────────────────────────────────────

describe("KpiTile refuses the two shapes that let a fabricated figure through", () => {
  it("will not compile when a figure and a reason are both supplied", () => {
    // The shape three call sites actually shipped: `value="—"` beside a conditional
    // `unavailableReason`, so the literal dash was the tile's live VALUE on every render where
    // the reason came back undefined. If the directive below ever reports itself UNUSED, the
    // union has been widened and D-38-16 is back to being enforced by convention.
    const bothAtOnce = (
      // @ts-expect-error — value + unavailableReason must not typecheck (D-38-16)
      <KpiTile
        id="owner-gross-margin"
        title="Gross margin"
        drillTo="/app/reports"
        density="comfortable"
        value="—"
        caption="Revenue less cost of goods"
        unavailableReason="cogs_paisa is NULL"
      />
    );
    expect(bothAtOnce).toBeTruthy();
  });

  it("will not compile when a polarity is declared with no delta to apply it to", () => {
    const inertPolarity = (
      // @ts-expect-error — `higherIsBetter` requires the `deltaPct` it describes.
      <KpiTile
        id="manager-late-tickets"
        title="Late tickets"
        drillTo="/app/kitchen"
        density="compact"
        value="3"
        caption="3 on the board now"
        higherIsBetter={false}
      />
    );
    expect(inertPolarity).toBeTruthy();
  });

  it("accepts a polarity beside a NULL delta — that is still a comparison", () => {
    render(
      <KpiTile
        id="owner-net-sales"
        title="Net sales"
        drillTo="/app/reports"
        density="comfortable"
        value="Rs 0.00"
        caption="0 orders"
        deltaPct={null}
        higherIsBetter={false}
      />,
    );
    expect(screen.getByTestId("kpi-delta-owner-net-sales")).toHaveTextContent(
      "No comparable prior period",
    );
  });

  it("renders the reason, not a zero, when a figure cannot be computed", () => {
    render(
      <KpiTile
        id="accountant-net-income"
        title="Net income"
        drillTo="/app/finance/gl"
        density="comfortable"
        caption="Revenue less cost of goods"
        unavailableReason="Cost of goods is not posted per sale."
      />,
    );

    expect(screen.getByTestId("kpi-value-accountant-net-income")).toHaveTextContent("—");
    expect(screen.getByTestId("portlet-accountant-net-income")).toHaveTextContent(
      "Cost of goods is not posted per sale.",
    );
    expect(screen.queryByTestId("kpi-delta-accountant-net-income")).toBeNull();
  });
});

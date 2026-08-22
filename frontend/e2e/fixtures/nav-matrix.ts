import type { PersonaLocal } from "./personas";

/**
 * THE ROLE → VISIBILITY MATRIX.
 *
 * This is an INDEPENDENT SPECIFICATION, deliberately hand-written rather than derived from
 * `components/shared/sidebar-nav-items.ts`. Deriving it would re-run the application's own
 * gating logic and assert that it equals itself — a tautology that passes even when the
 * gating is wrong. Every row below is instead a human claim about what a role should see,
 * which the UI is then measured against.
 *
 * GROUNDED IN THE BACKEND'S OWN GATE, not in the nav config. Each row is justified by the
 * permission code the SERVICE `@PreAuthorize`s for that screen, cross-checked against the
 * permission set a LIVE token actually carries. Measured 2026-08-22 against
 * dev.restaurantos.softxlogic.com by decoding the access token each persona's session refresh
 * returned:
 *
 *   OWNER          79  — everything, incl. rbac.manage, finance.*, hr.*, branch.manage,
 *                        pos.tax.manage, nlq.settings.manage, audit.log.view, ops.health.view
 *   MANAGER        57  — pos.* (incl. pos.till.review, pos.order.view.all, pos.tables.admin,
 *                        pos.menu.manage, pos.terminals.admin, pos.printers.admin),
 *                        inventory.*, vendor.*, crm.*, reporting.*, nlq.query.run.
 *                        NOT finance.journal.view, NOT pos.tax.manage, NOT audit.log.view,
 *                        NOT ops.health.view, NOT branch.manage, NOT rbac.*
 *   ACCOUNTANT     27  — finance.* (all), vendor.view, crm.customer.view, reporting.*,
 *                        nlq.query.run, and exactly ONE pos permission: pos.order.view
 *   CASHIER        14  — pos.order.*, pos.till.open/close, pos.menu.view, pos.tables.manage,
 *                        crm.customer.*  — NO pos.kds.view, NO pos.till.review,
 *                        NO pos.order.view.all, NO pos.menu.manage, NO pos.tables.admin
 *   WAITER          7  — pos.order.create/update/view/send_to_kds, pos.menu.view,
 *                        pos.kds.view, pos.tables.manage. No till of any kind.
 *   KITCHEN_STAFF   2  — pos.kds.view, pos.kds.update. Nothing else at all.
 *
 * TENANT IS FIXED TO `terrace` (Floating Terrace) so the ONLY variable is the role. Its
 * entitlements were read live from GET /api/v1/feature-flags in the same pass: it is ENTERPRISE
 * and holds ALL TWENTY `FeatureFlag` codes, so every module a nav row below depends on is
 * ENABLED and an item that is missing is missing because of RBAC — which is what this matrix is
 * for. Feature gating is tested separately, in tenant-feature-gating.spec.ts, against the
 * control tenant whose module set the seed deliberately diverges.
 *
 * (This docblock previously said "TENANT IS FIXED TO SAFFRON" and quoted permission counts read
 * from saffron, while the spec has run `const TENANT = "terrace"` since the seeder dropped the
 * other tenants. The evidence and the subject now match again.)
 */

/**
 * Every nav label the sidebar can render, so "hidden" is asserted rather than assumed.
 *
 * <h3>This list is the whole point of the negative half, and it had gone stale</h3>
 *
 * `hiddenFor()` can only accuse a role of seeing something it names here. Sixteen nav entries
 * shipped after this array was written — Tables, Stations, Station Routing, POS Terminals,
 * Printers, Sales Tax, Service Charge, AI, Guide, Takings, Branches, Roles, Audit log and
 * Service health among them — and until they were added, FOURTEEN OF THE THIRTY-FIVE ITEMS IN
 * THE SIDEBAR COULD NOT BE REPORTED AS LEAKED TO ANY ROLE. The suite was green on those items
 * for the same reason a test with no assertion is green.
 *
 * Several of the additions are load-bearing controls in their own right, and the nav config
 * says so in prose:
 *   · Tables is gated on `pos.tables.admin`, NOT the `pos.tables.manage` a WAITER holds to seat
 *     a guest — "using the latter here would put a floor-plan editor in every waiter's sidebar"
 *     (sidebar-nav-items.ts:236-241). This array is what turns that sentence into a test.
 *   · Audit log is gated on `audit.log.view`, which MANAGER deliberately does not hold —
 *     "a manager who can also read the void log is a manager who can see whether anyone is
 *     looking" (:562-567).
 *   · Service health is `ops.health.view`, OWNER/TENANT_ADMIN only (:575-583).
 *   · Sales Tax is `pos.tax.manage` and AI is `nlq.settings.manage`, both OWNER-only here.
 *
 * KEEP THIS IN SYNC when a nav entry ships. A new label absent from this array is not a failing
 * test — it is a silently unasserted one.
 */
export const ALL_NAV_LABELS = [
  // Overview
  "Dashboard",
  // Orders
  "POS",
  "Kitchen Display",
  "Till Review",
  // Menu
  "Inventory",
  "Menu Items",
  "Tables",
  "Stations",
  "Station Routing",
  "POS Terminals",
  "Printers",
  "Sales Tax",
  "Service Charge",
  "AI",
  // Finance
  "Guide",
  "Takings",
  "Accounts",
  "Journal Entries",
  "General Ledger",
  "Periods",
  "Expenses",
  "AP Aging",
  // Purchasing
  "Purchasing",
  // People
  "HR",
  "Customers",
  // Reporting
  "Reports",
  "Realtime Dashboard",
  "Ask (NLQ)",
  // Settings
  "General",
  "Branches",
  "Appearance",
  "Users",
  "Roles",
  "Audit log",
  "Service health",
] as const;

export type NavLabel = (typeof ALL_NAV_LABELS)[number];

/**
 * Items that are `comingSoon` in the nav config and must therefore be hidden from EVERY role,
 * including OWNER. A dead link in the sidebar is a UI defect, so this is asserted, not skipped.
 *
 * <h3>"General" and "Users" were removed from this list, deliberately</h3>
 *
 * They were listed as `comingSoon — no page`, and that was true when it was written. Plan 19-01
 * built both pages and dropped the flag: `sidebar-nav-items.ts:508-518` records that
 * `/app/settings` "now exists (`app/(tenant)/app/settings/page.tsx`), so `comingSoon` is gone",
 * and `:553-563` that the Users href moved off the never-built `/app/settings/users` to
 * `/app/users`, which does exist.
 *
 * Neither is ungated. General is `rbac.manage | branch.manage` and Users is
 * `rbac.manage | rbac.user.manage`, both `any`-matched — the exact expressions
 * `BranchController`'s writes and `/api/v1/users` `hasAnyAuthority(...)` on. An OWNER holding
 * `rbac.manage` (measured: it does) SHOULD see both, and
 * `__tests__/shared/nav-permission-matrix.test.tsx` has asserted precisely that at the hook
 * level since 19-01 while this fixture asserted the opposite in the browser. So the matrix was
 * stale and the product is right; keeping the rows would have meant demanding the OWNER be
 * denied two screens whose endpoints answer it 200.
 *
 * `Reporting` stays: `/app/reporting` still has no page (`:466-476`).
 */
export const NEVER_VISIBLE: string[] = [
  "Reporting", // /app/reporting has no page — comingSoon
];

export interface RoleExpectation {
  role: string;
  /**
   * A nav item that is BOTH permission- and feature-gated and that this role does hold.
   *
   * Load-bearing, and the reason is a measured race: "Dashboard" has no gates at all, so it
   * renders in the first paint, while every gated item appears only after `useNavItemVisible`
   * resolves GET /api/v1/feature-flags. Anchoring on Dashboard and then counting made all six
   * roles look like they were missing their entire sidebar (measured 2026-08-07: 0 of 18 items
   * present at the moment Dashboard became visible; all 19 present ~6s later).
   *
   * Waiting for a GATED item proves the gating pass has actually run, which is the only state
   * in which "this item is absent" means "it was gated out" rather than "it has not rendered".
   */
  anchor: NavLabel;
  /** Nav labels that MUST be present. */
  visible: NavLabel[];
  /**
   * A route this role must NOT be able to use, and the permission that gates it.
   * Chosen so the refusal is unambiguous — a route the role has no business reaching.
   */
  forbidden: { route: string; requires: string; why: string };
}

const FINANCE_LEDGER_NAV: NavLabel[] = [
  "Accounts",
  "Journal Entries",
  "General Ledger",
  "Periods",
  "Expenses",
  "AP Aging",
];

/**
 * Guide and Takings are NOT part of the ledger block above, and the split is itself an
 * assertion.
 *
 * Both are gated `finance.journal.view | pos.order.view.all | pos.till.review` with `any`
 * (`sidebar-nav-items.ts:370-388`), mirroring the three codes `DailyTakingsController` has
 * accepted since 37-09 — because the person who counts the drawer is the branch MANAGER, who
 * holds no ledger permission. A CASHIER holds `pos.till.open`/`pos.till.close` and neither
 * `pos.till.review` nor `pos.order.view.all`, so it does not reach them: the till operator is
 * kept out of branch revenue, which is the control this split exists to pin.
 */
const FINANCE_TAKINGS_NAV: NavLabel[] = ["Guide", "Takings"];

/** Screens gated on `pos.menu.manage` — the menu is edited by OWNER/TENANT_ADMIN/MANAGER only. */
const MENU_ADMIN_NAV: NavLabel[] = ["Menu Items", "Stations", "Station Routing"];

/** Equipment catalogues: `pos.terminals.admin` and `pos.printers.admin | branch.manage`. */
const EQUIPMENT_NAV: NavLabel[] = ["POS Terminals", "Printers"];

export const ROLE_MATRIX: Record<PersonaLocal, RoleExpectation> = {
  owner: {
    role: "OWNER",
    anchor: "POS",
    // The OWNER holds every tenant permission, so its row is the whole of ALL_NAV_LABELS minus
    // the `comingSoon` entries. Written out rather than spread from ALL_NAV_LABELS on purpose:
    // deriving it would make "the owner sees everything" true by construction and would stop
    // catching an item that ships gated on a code even the owner does not hold.
    visible: [
      "Dashboard",
      "POS",
      "Kitchen Display",
      "Till Review",
      "Inventory",
      ...MENU_ADMIN_NAV,
      "Tables", // pos.tables.admin
      ...EQUIPMENT_NAV,
      "Sales Tax", // pos.tax.manage
      "Service Charge", // read gated on pos.menu.view; write on pos.service_charge.manage
      "AI", // nlq.settings.manage
      ...FINANCE_TAKINGS_NAV,
      ...FINANCE_LEDGER_NAV,
      "Purchasing",
      "HR",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
      "General", // rbac.manage | branch.manage
      "Branches", // rbac.manage | branch.manage
      "Appearance", // roles: OWNER, TENANT_ADMIN
      "Users", // rbac.manage | rbac.user.manage
      "Roles", // rbac.manage | rbac.user.manage | rbac.role.manage
      "Audit log", // audit.log.view
      "Service health", // ops.health.view
    ],
    // The OWNER holds every TENANT permission, so the only thing it must not reach is the
    // CONTROL PLANE. A tenant token carries no platform authority at all.
    forbidden: {
      route: "/platform/dashboard",
      requires: "platform:admin (a platform token, which no tenant login can mint)",
      why: "a tenant OWNER is not a SuperAdmin; tenant tokens carry no platform claims",
    },
  },

  manager: {
    role: "MANAGER",
    anchor: "POS",
    visible: [
      "Dashboard",
      "POS",
      "Kitchen Display",
      "Till Review",
      "Inventory",
      ...MENU_ADMIN_NAV,
      "Tables",
      ...EQUIPMENT_NAV,
      // Reached through `pos.till.review` / `pos.order.view.all`, not through the ledger — see
      // FINANCE_TAKINGS_NAV. The absence of FINANCE_LEDGER_NAV from this row is what keeps that
      // honest: the module opened by one code, it did not open wholesale.
      ...FINANCE_TAKINGS_NAV,
      "Service Charge",
      "Purchasing",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
    ],
    // MANAGER holds finance.ar.view and finance.expense.approve but NOT finance.journal.view,
    // which is what every Finance LEDGER nav item and the ledger pages are gated on. This is the
    // most surprising row in the matrix and therefore the most worth pinning.
    //
    // Four more absences are asserted by omission and are each a deliberate backend decision:
    // Sales Tax (`pos.tax.manage`), AI (`nlq.settings.manage`), Audit log (`audit.log.view` — a
    // manager can void an order, so a manager who could also read the void log could check
    // whether anyone is looking) and Service health (`ops.health.view`, OWNER/TENANT_ADMIN only).
    forbidden: {
      route: "/app/finance/journal-entries",
      requires: "finance.journal.view",
      why: "MANAGER's permissions include finance.ar.view but NOT finance.journal.view",
    },
  },

  accountant: {
    role: "ACCOUNTANT",
    anchor: "POS",
    visible: [
      "Dashboard",
      "POS", // holds pos.order.view — its ONLY pos permission
      ...FINANCE_TAKINGS_NAV, // reached through finance.journal.view
      ...FINANCE_LEDGER_NAV,
      "Purchasing",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
    ],
    // Note what that single `pos.order.view` does NOT buy: no Kitchen Display, no Till Review,
    // no Tables, no menu administration, and no Service Charge — that one is gated on
    // `pos.menu.view`, which the accountant does not hold, so the row that is legitimately
    // visible to a waiter is correctly hidden here.
    forbidden: {
      route: "/app/kitchen",
      requires: "pos.kds.view",
      why: "ACCOUNTANT holds exactly one pos.* permission (pos.order.view); the KDS is not it",
    },
  },

  cashier: {
    role: "CASHIER",
    anchor: "POS",
    // "Service Charge" is here on purpose and is the one row in this matrix that LOOKS like
    // over-granting and is not. Its READ is gated on `pos.menu.view` — which a cashier holds —
    // because the charge is printed on every bill they hand a guest; its WRITE is
    // `pos.service_charge.manage`, granted to OWNER and TENANT_ADMIN only (auth changeset 093),
    // so the page renders with every control disabled. The page states this itself
    // (`app/(tenant)/app/settings/service-charge/page.tsx:27-36`), for a MANAGER. Whether the
    // READ should be narrowed below manager is a product decision worth taking; it is not a
    // defect against the gate as written, and hiding the row here would make this fixture
    // assert a rule the backend does not have.
    visible: ["Dashboard", "POS", "Service Charge", "Customers"],
    // The cashier OPENS and CLOSES a till but must never REVIEW one — that is the
    // manager/owner control that approves or flags the cashier's own count. It also does not
    // reach Takings: that needs `pos.till.review` or `pos.order.view.all`, and holding
    // `pos.till.open` alone is deliberately not enough to see the branch's day.
    forbidden: {
      route: "/app/pos/tills",
      requires: "pos.till.review",
      why: "a cashier reviewing its own till would defeat the separation the control exists for",
    },
  },

  waiter: {
    role: "WAITER",
    anchor: "POS",
    // Holds pos.kds.view, so the board is legitimately visible — the waiter watches
    // readiness. It holds NO till permission of any kind, which is D-30's whole point.
    //
    // It holds `pos.tables.manage` (to seat a guest) and NOT `pos.tables.admin`, so "Tables" —
    // the floor-plan catalogue — is absent, exactly as sidebar-nav-items.ts:236-241 intends.
    // "Service Charge" is present for the same `pos.menu.view` reason as the cashier's row.
    visible: ["Dashboard", "POS", "Kitchen Display", "Service Charge"],
    forbidden: {
      route: "/app/pos/tills",
      requires: "pos.till.review",
      why: "a WAITER holds no pos.till.* permission at all — it cannot even open one",
    },
  },

  kitchen: {
    role: "KITCHEN_STAFF",
    anchor: "Kitchen Display",
    // Two permissions in total, and the sidebar is two items. Every other label in
    // ALL_NAV_LABELS is asserted absent for this role, which makes it the tightest
    // over-granting check in the file.
    visible: ["Dashboard", "Kitchen Display"],
    forbidden: {
      route: "/app/pos",
      requires: "pos.order.update",
      why: "KITCHEN_STAFF holds pos.kds.view/update only — it cannot take or amend an order",
    },
  },
};

/** Labels this role must NOT see: everything in ALL_NAV_LABELS it does not expect. */
export function hiddenFor(local: PersonaLocal): string[] {
  const visible = new Set<string>(ROLE_MATRIX[local].visible);
  return [...ALL_NAV_LABELS.filter((l) => !visible.has(l)), ...NEVER_VISIBLE];
}

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
 * GROUNDED IN MEASURED PERMISSIONS, not in the nav config. Each role's permission set was
 * read from a LIVE token minted by the real gateway on 2026-08-07 (saffron-grill):
 *
 *   OWNER          65  — everything, incl. rbac.manage, finance.*, hr.*, branch.manage
 *   MANAGER        49  — pos.*, inventory.*, vendor.*, crm.*, reporting.*, nlq.query.run
 *                        but NO finance.journal.view (it holds finance.ar.view only)
 *   ACCOUNTANT     24  — finance.* (all 10), vendor.view, crm.customer.view, reporting.*,
 *                        nlq.query.run, and exactly ONE pos permission: pos.order.view
 *   CASHIER        14  — pos.order.*, pos.till.open/close, pos.menu.view, crm.customer.*
 *                        but NO pos.kds.view and NO pos.till.review
 *   WAITER          7  — pos.order.create/update/view/send_to_kds, pos.menu.view,
 *                        pos.kds.view, pos.tables.manage. No till of any kind.
 *   KITCHEN_STAFF   2  — pos.kds.view, pos.kds.update. Nothing else at all.
 *
 * TENANT IS FIXED TO SAFFRON so the ONLY variable is the role. Saffron's entitlements were
 * read live too: CRM, FINANCE, HR, INVENTORY, KDS, LOYALTY, NLQ, PAYROLL, POS, VENDOR are ON;
 * ANALYTICS, MULTI_BRANCH and REPORTING_ADVANCED are OFF. Every module a nav row below
 * depends on is therefore ENABLED, so an item that is missing is missing because of RBAC —
 * which is what this matrix is for. Feature gating is tested separately, in
 * tenant-feature-gating.spec.ts, on a tenant chosen to differ.
 */

/** Every nav label the sidebar can render, so "hidden" is asserted rather than assumed. */
export const ALL_NAV_LABELS = [
  "Dashboard",
  "POS",
  "Kitchen Display",
  "Till Review",
  "Inventory",
  "Menu Items",
  "Accounts",
  "Journal Entries",
  "General Ledger",
  "Periods",
  "Expenses",
  "AP Aging",
  "Purchasing",
  "HR",
  "Customers",
  "Reports",
  "Realtime Dashboard",
  "Ask (NLQ)",
  "Appearance",
] as const;

export type NavLabel = (typeof ALL_NAV_LABELS)[number];

/**
 * Items that are `comingSoon` in the nav config and must therefore be hidden from EVERY role,
 * including OWNER. A dead link in the sidebar is a UI defect, so this is asserted, not skipped.
 */
export const NEVER_VISIBLE: string[] = [
  "Reporting", // /app/reporting has no page — comingSoon
  "General", // /app/settings has no page — comingSoon
  "Users", // /app/settings/users has no page — comingSoon
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

const FINANCE_NAV: NavLabel[] = [
  "Accounts",
  "Journal Entries",
  "General Ledger",
  "Periods",
  "Expenses",
  "AP Aging",
];

export const ROLE_MATRIX: Record<PersonaLocal, RoleExpectation> = {
  owner: {
    role: "OWNER",
    anchor: "POS",
    visible: [
      "Dashboard",
      "POS",
      "Kitchen Display",
      "Till Review",
      "Inventory",
      "Menu Items",
      ...FINANCE_NAV,
      "Purchasing",
      "HR",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
      "Appearance",
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
      "Menu Items",
      "Purchasing",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
    ],
    // MANAGER holds finance.ar.view and finance.expense.approve but NOT finance.journal.view,
    // which is what every Finance nav item and the ledger pages are gated on. This is the
    // most surprising row in the matrix and therefore the most worth pinning.
    forbidden: {
      route: "/app/finance/journal-entries",
      requires: "finance.journal.view",
      why: "MANAGER's 49 permissions include finance.ar.view but NOT finance.journal.view",
    },
  },

  accountant: {
    role: "ACCOUNTANT",
    anchor: "POS",
    visible: [
      "Dashboard",
      "POS", // holds pos.order.view — its ONLY pos permission
      ...FINANCE_NAV,
      "Purchasing",
      "Customers",
      "Reports",
      "Realtime Dashboard",
      "Ask (NLQ)",
    ],
    forbidden: {
      route: "/app/kitchen",
      requires: "pos.kds.view",
      why: "ACCOUNTANT holds exactly one pos.* permission (pos.order.view); the KDS is not it",
    },
  },

  cashier: {
    role: "CASHIER",
    anchor: "POS",
    visible: ["Dashboard", "POS", "Customers"],
    // The cashier OPENS and CLOSES a till but must never REVIEW one — that is the
    // manager/owner control that approves or flags the cashier's own count.
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
    visible: ["Dashboard", "POS", "Kitchen Display"],
    forbidden: {
      route: "/app/pos/tills",
      requires: "pos.till.review",
      why: "a WAITER holds no pos.till.* permission at all — it cannot even open one",
    },
  },

  kitchen: {
    role: "KITCHEN_STAFF",
    anchor: "Kitchen Display",
    // Two permissions in total. The dashboard is the kitchen-specific one.
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

import {
  Activity,
  Building2,
  CreditCard,
  FileClock,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  ServerCog,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The SuperAdmin console's navigation, as data.
 *
 * <h3>Why the console carries its own list and does not extend `sidebar-nav-items.ts`</h3>
 *
 * That file's `NavItem` is built for the TENANT shell: every item is gated by a `permission` code
 * and a `feature` flag, and both gates are evaluated against a tenant principal's claims. A
 * platform token carries neither — it has one authority, `SUPER_ADMIN`, no `permissions` array and
 * no feature entitlements, because features are a per-tenant fact and the control plane is not in
 * a tenant. Reusing that type here would mean declaring gates that nothing evaluates, which is how
 * a nav item ends up looking guarded and being open.
 *
 * <p>The whole console is behind `PlatformGuard`, which requires a tenant-less token AND the
 * `SUPER_ADMIN` claim. That is the only gate these routes have, and it is on the route group
 * rather than on the links — so a link here is visible exactly when the console is, which is the
 * correct relationship and the reason there is no per-item `permission` field to forget to fill in.
 *
 * <h3>`comingSoon`, and why it exists rather than being deleted</h3>
 *
 * GA-053 was the product's only unguarded dead link: `/platform/tenants` sat in `platformNavItems`
 * with no `page.tsx` behind it and rendered a bare "404: This page could not be found." Five of
 * nine audits reported it independently. The lesson recorded there is that a nav pointing at a
 * route that does not exist is worse than a nav that admits the screen is not built — so an item
 * whose page has not landed renders as a stated, unclickable absence and never as an anchor.
 *
 * <p>Each flag below is set from what exists in `app/(platform)/` today. **Landing one of these
 * screens means deleting one `comingSoon: true` in this file**, and that is deliberately a
 * one-token edit rather than a structural one.
 */
export interface PlatformNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The page does not exist yet. Rendered as an inert row, never as a link. */
  comingSoon?: boolean;
  /**
   * One line for a tooltip and for the collapsed rail's accessible description. Says what the
   * screen answers, not what it is called — the label already says that.
   */
  hint: string;
}

export interface PlatformNavGroup {
  /** UPPERCASE at `tracking-eyebrow`. The tenant sidebar's group voice, deliberately identical. */
  label: string;
  items: PlatformNavItem[];
}

export const platformNavGroups: PlatformNavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Platform overview",
        href: "/platform/dashboard",
        icon: LayoutDashboard,
        hint: "Tenant population, alerts needing action, and fleet status.",
      },
    ],
  },
  {
    label: "Tenants",
    items: [
      {
        label: "All tenants",
        href: "/platform/tenants",
        icon: Building2,
        hint: "Every restaurant group, its lifecycle state and its entitlements.",
      },
    ],
  },
  {
    label: "Users & access",
    items: [
      {
        label: "User directory",
        href: "/platform/users",
        icon: Users,
        hint: "Find a user across every tenant, and act on their account.",
      },
      {
        // `/platform/access`, not `/platform/rbac`. The label an operator reads is "Roles &
        // permissions"; an acronym in a URL is a term of art borrowed from the schema rather than
        // from the product. Nothing ever linked to the old path — it was a `comingSoon` entry with
        // no page behind it — so there is no redirect to maintain.
        label: "Roles & permissions",
        href: "/platform/access",
        icon: KeyRound,
        hint: "The role catalogue, read-only to the platform tier.",
      },
      {
        // Added with the endpoint that backs it, not before. This route was a 404 until
        // GET /api/v1/platform/impersonations existed; a nav entry pointing at one of those is
        // the GA-053 defect.
        label: "Impersonations",
        href: "/platform/impersonations",
        icon: ShieldAlert,
        hint: "Who entered which tenant, when, and for how long.",
      },
      {
        label: "Operator audit",
        href: "/platform/operator-audit",
        icon: FileClock,
        comingSoon: true,
        hint: "Every platform-tier action on a tenant user, with its stated reason.",
      },
    ],
  },
  {
    label: "Subscriptions",
    items: [
      {
        // `comingSoon` deleted with the page that landed behind it, which is the one-token edit
        // this flag exists to be. GA-053's lesson holds in both directions: a nav item pointing at
        // a route with no `page.tsx` renders a bare 404, and an item still marked coming-soon after
        // its screen ships is an operator being told a capability does not exist when it does.
        label: "Plans",
        href: "/platform/plans",
        icon: CreditCard,
        hint: "What each plan grants and what it is sold at.",
      },
      {
        label: "Subscriptions",
        href: "/platform/subscriptions",
        icon: ScrollText,
        hint: "Trials, renewals, scheduled changes and cancellations across the fleet.",
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      {
        label: "Growth & usage",
        href: "/platform/analytics",
        icon: Activity,
        hint: "Tenant growth, and usage measured against entitlement.",
      },
      {
        label: "Audit trail",
        href: "/platform/audit",
        icon: Gauge,
        hint: "The read-only platform view of what was done and by whom.",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "System status",
        href: "/platform/system",
        icon: ServerCog,
        hint: "Live probes of every service, database, cache and broker.",
      },
    ],
  },
];

/** Is `pathname` inside this item's subtree? Exact match, or a `/`-delimited descendant. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

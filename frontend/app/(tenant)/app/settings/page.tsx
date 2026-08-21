"use client";

import {
  Activity,
  Building2,
  Palette,
  Percent,
  Printer,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { BranchSettingsForm } from "@/components/settings/branch-settings-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InsetRow } from "@/components/ui/inset-row";
import { PageHeader } from "@/components/ui/page-header";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Settings — the index (GA-009, 38-10 task 2, UI-SPEC §55).
 *
 * <h3>What changed here in 38-10, and what deliberately did not</h3>
 *
 * <p>The page kept its two surviving jobs — it saves branch details through
 * `PUT /api/v1/branches/{id}`, and it is the `expressive` zone anchor the visual e2e reads —
 * and gained the one it was missing: <b>a map of where every settings surface actually is</b>.
 * Before this it offered exactly two onward links (Users, Appearance) while ten further
 * settings screens existed and were reachable only from three different sidebar groups. An
 * owner looking for the sales-tax rate had no reason to believe Settings knew about it.
 *
 * <h3>Fourteen groups were specified. Ten exist. The four that do not are NAMED.</h3>
 *
 * <p>§55 names General · Restaurant · Branches · Users · Roles · Permissions · Taxes ·
 * Payments · Printers · Kitchen · Notifications · Integrations · Security · Appearance.
 * Measured against this codebase, four of those have no backing surface at all:
 *
 * <ul>
 *   <li><b>Restaurant</b> — there is no tenant-profile API. `/api/v1/tenant-profile`,
 *       `/api/v1/tenants/{id}/settings` and `/api/v1/settings` all 404 (measured as
 *       TENANT_ADMIN through the real gateway, 2026-08-11). A branch is the only editable
 *       scope, and it is the form above.</li>
 *   <li><b>Payments</b> — no payment-method configuration exists anywhere in the product.
 *       `/app/purchasing/payments` is a vendor-payment ledger, not a settings surface.</li>
 *   <li><b>Notifications</b> — `notification-service` is unregistered (§52). Out of scope by
 *       this plan's own statement.</li>
 *   <li><b>Permissions</b> — real, but not a separate screen: the permission codes are read and
 *       granted inside Roles, which is where the decision is actually made. A "Permissions" tab
 *       listing codes nobody can act on would be a fourteenth tab that answers nothing.</li>
 * </ul>
 *
 * <p>They are stated at the bottom of this page rather than rendered as four empty tabs.
 * Fourteen tabs, four of them empty, is a worse product than ten that work — and an owner who
 * reads "not in this release, because there is no service behind it" stops looking, which is
 * the entire point of D-38-16 applied to navigation instead of to a number.
 *
 * <h3>Every tile is permission-gated at the tile, not at the page</h3>
 *
 * <p>The gates below are the same expressions each destination enforces, copied from its own
 * route file — not a broader "is an admin" test. A tile offering a screen whose read 403s is
 * the defect `sidebar-nav-items.ts` documents at length; this page must not reintroduce it one
 * level down.
 */
function SettingsPage() {
  const { branchId, permissions, roles } = useCurrentUser();

  const has = (...codes: string[]) => codes.some((code) => permissions.includes(code));
  const isTenantAdmin = roles.includes("OWNER") || roles.includes("TENANT_ADMIN");

  // Each entry mirrors the gate its own route declares. Grouped by the errand, not by service.
  const groups: Array<{
    id: string;
    title: string;
    blurb: string;
    entries: Array<{
      href: string;
      label: string;
      description: string;
      icon: typeof Users;
      allowed: boolean;
    }>;
  }> = [
    {
      id: "people",
      title: "People and access",
      blurb: "Who works here, what each of them may do, and the record of what they did.",
      entries: [
        {
          href: "/app/users",
          label: "Users",
          description:
            "Add staff, set what they can do on each branch, and issue a password when someone is locked out.",
          icon: Users,
          allowed: has("rbac.manage", "rbac.user.manage"),
        },
        {
          href: "/app/roles",
          label: "Roles and permissions",
          description:
            "What each role grants, across every permission code this system defines. Build your own when the built-in roles do not match how you work.",
          icon: ShieldCheck,
          allowed: has("rbac.manage", "rbac.user.manage", "rbac.role.manage"),
        },
        {
          href: "/app/settings/audit",
          label: "Audit log",
          description:
            "Every sign-in, void, refund, till session, role change and journal posting — and who did it. Nobody can edit or delete a line of it.",
          icon: ScrollText,
          allowed: has("audit.log.view"),
        },
      ],
    },
    {
      id: "restaurant",
      title: "This restaurant",
      blurb: "The locations you trade from, and what the app looks like while you do it.",
      entries: [
        {
          href: "/app/branches",
          label: "Branches",
          description:
            "Every location this restaurant trades from. Adding one puts you on it, so you can set up its menu, staff and till.",
          icon: Building2,
          allowed: has("rbac.manage", "branch.manage"),
        },
        {
          href: "/settings/appearance",
          label: "Appearance",
          description:
            "Brand colour and logo. Stored in this browser only — it is not saved to your account, so colleagues and your other devices see the default.",
          icon: Palette,
          allowed: isTenantAdmin,
        },
      ],
    },
    {
      id: "selling",
      title: "What you charge, and on what",
      blurb: "The numbers that apply to every check rather than to one dish.",
      entries: [
        {
          href: "/app/settings/tax",
          label: "Sales tax",
          description:
            "The rates you charge guests. Set a rate once here, then apply it to a menu category — every dish in it inherits the rate.",
          icon: Percent,
          allowed: has("pos.tax.manage", "rbac.manage"),
        },
        {
          href: "/app/settings/service-charge",
          label: "Service charge",
          description:
            "What this branch adds to a check for table service, and which channels it applies to.",
          icon: ReceiptText,
          allowed: has("pos.service_charge.manage", "pos.menu.view"),
        },
      ],
    },
    {
      id: "floor",
      title: "The floor and the kitchen",
      blurb: "The hardware-that-is-not-hardware: named tills, ticket destinations, printers.",
      entries: [
        {
          href: "/app/terminals",
          label: "POS terminals",
          description:
            "Named tills. Each decides which part of the menu it offers and which stations its orders fire to.",
          icon: UtensilsCrossed,
          allowed: has("pos.terminals.admin"),
        },
        {
          href: "/app/stations",
          label: "Stations",
          description:
            "Where a ticket goes — the grill, the bar, the pass. A station's type decides which screen it appears on.",
          icon: UtensilsCrossed,
          allowed: has("pos.menu.manage"),
        },
        {
          href: "/app/settings/printers",
          label: "Printers",
          description:
            "The receipt printer at the till and the ticket printers in the kitchen, and the machine that drives them.",
          icon: Printer,
          allowed: has("pos.printers.admin", "branch.manage", "rbac.manage"),
        },
      ],
    },
    {
      id: "system",
      title: "The software itself",
      blurb: "Nothing here is restaurant data.",
      entries: [
        {
          href: "/app/settings/ai",
          label: "AI provider",
          description: "Which AI provider answers your questions, and whose account it bills to.",
          icon: Sparkles,
          allowed: has("nlq.settings.manage"),
        },
        {
          href: "/app/settings/health",
          label: "Service health",
          description:
            "Whether each part of RestaurantOS is answering right now, and when it last did.",
          icon: Activity,
          allowed: has("ops.health.view"),
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => entry.allowed) }))
    .filter((group) => group.entries.length > 0);
  const reachable = visibleGroups.reduce((n, group) => n + group.entries.length, 0);

  return (
    /*
     * ZONE: expressive (D-34-02) — settings is named in the decision's table, alongside
     * dashboards and the console. It was inheriting `restrained` from the back-office shell,
     * which is the shell's correct default but not what this screen was assigned.
     *
     * Nested inside the restrained shell, exactly as the dashboard is: the page is richer than
     * the chrome above it, and the chrome stays poor because it also renders over the POS.
     *
     * `e2e/journeys/expressive-surfaces-visual.spec.ts:86` anchors on `[data-zone="expressive"]`
     * at this route. Do not move it.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Settings"
        description="How this branch is set up, and who can sign in to it."
        meta={
          <>
            {reachable} {reachable === 1 ? "setting you can open" : "settings you can open"} · four
            groups have no service behind them yet, listed at the foot of this page
          </>
        }
      />

      {/*
        The one thing this page SAVES, kept at the top. Everything below it is navigation.
        `/api/v1/branches/{id}` is the only settings write endpoint that exists.
      */}
      <BranchSettingsForm branchId={branchId || null} />

      {visibleGroups.map((group) => (
        <Card key={group.id} depth={1}>
          <CardHeader>
            {/*
              A real <h2>, not `CardTitle` — that primitive renders a <div>, so five group cards
              left the page with a single <h1> and no outline beneath it. `PageHeader` owns the
              one <h1>; every group name below it is a level 2.
            */}
            <h2 id={`settings-group-${group.id}`} className="text-h2 font-semibold">
              {group.title}
            </h2>
            <p className="text-small text-foreground-secondary">{group.blurb}</p>
          </CardHeader>
          <CardContent>
            <ul
              aria-labelledby={`settings-group-${group.id}`}
              className="grid gap-(--space-sm) sm:grid-cols-2"
            >
              {group.entries.map((entry) => (
                <InsetRow
                  key={entry.href}
                  as="li"
                  href={entry.href}
                  leading={<entry.icon className="mt-0.5 size-4 text-primary" aria-hidden="true" />}
                  primary={entry.label}
                  secondary={entry.description}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {/*
        The stated absence. Four of §55's fourteen groups, named with the reason each one has no
        screen — because an owner who cannot find "Notifications" and is told nothing concludes
        the product has one and they are bad at finding it.
      */}
      <Card depth={1}>
        <CardHeader>
          <h2 className="text-h2 font-semibold">Not in this release</h2>
          <p className="text-small text-foreground-secondary">
            Four settings groups have no service behind them, so there is no screen. They are
            named here rather than shown as empty tabs.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-(--space-md) sm:grid-cols-2" data-testid="settings-absent-groups">
            <div>
              <dt className="text-body font-medium">Restaurant profile</dt>
              <dd className="mt-1 text-small text-foreground-tertiary">
                There is no tenant-profile API — a branch is the only editable scope, and it is the
                form at the top of this page.
              </dd>
            </div>
            <div>
              <dt className="text-body font-medium">Payments</dt>
              <dd className="mt-1 text-small text-foreground-tertiary">
                No payment-method configuration exists in the product yet. Vendor payments on the
                Purchasing screen are a ledger, not a setting.
              </dd>
            </div>
            <div>
              <dt className="text-body font-medium">Notifications</dt>
              <dd className="mt-1 text-small text-foreground-tertiary">
                The notification service is not deployed, so there is nothing a preference here
                could switch on.
              </dd>
            </div>
            <div>
              <dt className="text-body font-medium">Permissions</dt>
              <dd className="mt-1 text-small text-foreground-tertiary">
                Not missing — it lives inside Roles, which is where a permission is actually
                granted. A separate list of codes would not be actionable.
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </ZoneProvider>
  );
}

export default function Page() {
  return (
    <PermissionGuard
      require={["rbac.manage", "branch.manage"]}
      mode="any"
      fallback={<AccessDenied />}
    >
      <SettingsPage />
    </PermissionGuard>
  );
}

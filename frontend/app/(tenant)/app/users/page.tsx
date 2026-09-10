"use client";

import { useState } from "react";
import { ShieldCheck, UserCheck, UserMinus, Users } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { UserDetailPanel } from "@/components/users/user-detail-panel";
import { UserList } from "@/components/users/user-list";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { countLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
import { useAssignableRoles, useUsers } from "@/lib/hooks/use-users";
import type { TenantUser } from "@/lib/models/user.model";

/**
 * Tenant user management — GA-003.
 *
 * <p>The complete `/api/v1/users` CRUD shipped in plan 13-12 with 56 live assertions across two
 * genuinely provisioned tenants, and had <b>zero frontend consumers</b>: the only trace of it in
 * this app was a `comingSoon: true` nav entry pointing at a route that 404'd. This page is that
 * consumer. Nothing here is new backend surface and nothing here is stubbed.
 *
 * <p><b>No `FeatureGuard`.</b> Administering the people who work at the restaurant is not a module
 * a tier can switch off, and `RouteFeatureMap` carries no entry for `/api/v1/users` — wrapping this
 * in a feature gate would invent an entitlement the gateway does not enforce and would hide the
 * screen for a tenant fully entitled to it.
 *
 * <p>The permission gate is `any` of the two administration codes because the backend's own gate is
 * `hasAnyAuthority('rbac.manage','rbac.user.manage')`. OWNER holds the first; TENANT_ADMIN
 * deliberately holds only the second (13-02 split them so a tenant admin cannot mint an OWNER).
 * Requiring both would lock out the role this screen exists for — measured: a TENANT_ADMIN's token
 * carries `rbac.user.manage` and `rbac.role.manage` and NOT `rbac.manage`.
 */
function UsersPage() {
  const [selected, setSelected] = useState<TenantUser | null>(null);

  /*
   * The stat row's figures come from the SERVER'S OWN totals, not from the page of rows on
   * screen.
   *
   * `size: 1` because only `meta.totalCount` is wanted and the repository's contract says that
   * field is "the honest total even when the requested size was capped" — so this asks the
   * cheapest question that has an honest answer. Counting `active` off the 25 visible rows and
   * calling it a tenant figure would have been the alternative, and it would have been a lie on
   * any tenant with 26 people. `deactivated` is arithmetic between two stated totals, which is
   * the only derivation D-38-16 allows without a stated absence.
   */
  const totalQuery = useUsers({ page: 0, size: 1 });
  const activeQuery = useUsers({ page: 0, size: 1, activeOnly: true });
  const rolesQuery = useAssignableRoles();

  const total = totalQuery.data?.meta.totalCount;
  const active = activeQuery.data?.meta.totalCount;
  const roleCount = rolesQuery.data?.roles.length;
  const deactivated = total !== undefined && active !== undefined ? total - active : undefined;
  const countsReady = total !== undefined && active !== undefined && deactivated !== undefined;

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Users"
        description="Everyone who can sign in to this restaurant. Add staff, set what they can do on each branch, and issue a password when someone is locked out."
        /*
         * The `·` stat subtitle, and every part of it reconciles with the roster beneath: the
         * count is the same `totalCount` the FilterBar strip prints, and active + deactivated
         * sum to it exactly.
         */
        meta={
          countsReady
            ? statLine(
                countLine(total, "person", "people"),
                `${formatNumber(active)} active`,
                `${formatNumber(deactivated)} deactivated`,
                roleCount !== undefined ? countLine(roleCount, "role") : undefined,
              )
            : undefined
        }
      />

      {/*
       * The demo's KPI strip: four across at desktop, two at tablet, one on a phone
       * (`DEMO-COMPONENTS.md` — `.kpi-card` is its most-repeated component, 24 instances).
       * It sits ABOVE the two-column body so the figures span the full width rather than being
       * squeezed into the list column.
       */}
      <div className="grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        {countsReady ? (
          <>
            <StatTile
              label="People with a login"
              value={formatNumber(total)}
              icon={Users}
              accent="primary"
            />
            <StatTile
              label="Active"
              value={formatNumber(active)}
              icon={UserCheck}
              accent="secondary"
            />
            <StatTile label="Deactivated" value={formatNumber(deactivated)} icon={UserMinus} />
            {roleCount === undefined ? (
              /*
               * D-38-16: the role catalogue answers 403 for anyone below tenant administration,
               * and this screen is reachable by `rbac.user.manage` alone. A tile that showed 0
               * roles would say the restaurant has no roles, which is never true.
               */
              <StatTile
                label="Roles you can assign"
                unavailableReason="The role catalogue is not readable with the permissions you hold, so this cannot be counted here."
                icon={ShieldCheck}
              />
            ) : (
              <StatTile
                label="Roles you can assign"
                value={formatNumber(roleCount)}
                icon={ShieldCheck}
              />
            )}
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)
        )}
      </div>

      {/*
        `grid-cols-[minmax(0,1fr)]` on the BASE, not only at `lg`.

        A grid item defaults to `min-width: auto`, which means it refuses to shrink below its
        content. The `lg:` track already says `minmax(0,1fr)` and the single-column track below it
        said nothing, so at 390 this page ran 110px wider than the viewport with NOTHING selected —
        the search field, the "Active only" checkbox and "Add user" were all cut off at the right
        edge, and so was anything in the detail panel. Measured with
        `e2e/s2-overflow-blame.mjs`, which walks every element and reports the shallowest ones whose
        right edge is outside the viewport: the offender is this grid's own child, on the empty page,
        and `/app/dashboard` under the same probe has none.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <UserList selectedId={selected?.id ?? null} onSelect={setSelected} />
        <UserDetailPanel userId={selected?.id ?? null} />
      </div>
    </PageBody>
  );
}

export default function Page() {
  return (
    <PermissionGuard
      require={["rbac.manage", "rbac.user.manage"]}
      mode="any"
      fallback={<AccessDenied />}
    >
      <UsersPage />
    </PermissionGuard>
  );
}

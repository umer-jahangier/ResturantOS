"use client";

import { useState } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { UserDetailPanel } from "@/components/users/user-detail-panel";
import { UserList } from "@/components/users/user-list";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Everyone who can sign in to this restaurant. Add staff, set what they can do on each
          branch, and issue a password when someone is locked out.
        </p>
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
    </div>
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

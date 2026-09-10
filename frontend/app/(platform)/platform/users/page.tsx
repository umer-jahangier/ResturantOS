"use client";

import { PageHeader } from "@/components/ui/page-header";
import { FleetUserDirectory } from "@/components/platform/fleet-user-directory";

/**
 * URL: `/platform/users` — every person on the platform, across every restaurant.
 *
 * <h3>What this route is for</h3>
 *
 * The genuine fleet-wide question: *"find the user with this email, I do not know which tenant they
 * belong to"*. When the tenant IS known, that tenant's own page has the same list for one HTTP call
 * instead of one per restaurant, and this screen says so.
 *
 * <h3>What it will not show, and why that is the feature</h3>
 *
 * A total it cannot compute. There is no cross-tenant user query anywhere in this product —
 * `auth_db.users` is FORCE row-level security on `app.current_tenant_id`, `platform_db` holds no
 * grant in `auth_db` and has neither FDW nor dblink, and the only door takes a single
 * `X-Tenant-Id` — so the list behind this heading is assembled one call per tenant, with one chance
 * per tenant to fail. When any of them does, the API withholds the total and names the tenants it
 * could not read, and this screen renders exactly that: the rows it has, the restaurants it is
 * missing, and no number that reads as complete.
 *
 * <p>There is also no "active this week", no session count and no login frequency. `last_login_at`
 * is the only activity signal the platform records about a person; attempt-level history lives in
 * `audit_db.audit_events`, which the platform plane cannot read at all.
 */
export default function PlatformUsersPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="People"
        description="Every user account across every restaurant on the platform — and an honest account of how much of the fleet this list actually reached."
      />

      <FleetUserDirectory />
    </div>
  );
}

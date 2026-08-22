"use client";

import { PageHeader } from "@/components/ui/page-header";
import { PermissionMatrix } from "@/components/platform/permission-matrix";

/**
 * URL: `/platform/access` — the authorization model, as the platform tier is allowed to see it.
 *
 * <h3>Three reads and no writes</h3>
 *
 * The API behind this screen exposes exactly three endpoints — the permission vocabulary, the role
 * catalogue, and the role × permission matrix — and no mutation of any kind. That is a security
 * decision recorded in the responses themselves rather than an unfinished feature, and the screen
 * renders the API's own `readOnlyReason` beside a disabled Edit control instead of pretending the
 * capability is coming.
 *
 * <p>The reason, in short: composing a role IS granting authority. The tenant tier bounds that with
 * the role ceiling — an assigner may only grant permissions they already hold, recomputed from the
 * database on every call — and a platform operator holds no `user_branch_roles` at all, so the
 * ceiling resolves the empty set against them. A platform-tier role editor would let one author a
 * role granting anything and place it in any tenant, which is precisely the escalation that
 * splitting `rbac.manage` out of `rbac.role.manage` was done to prevent.
 *
 * <h3>Why the route is `/platform/access` rather than `/platform/rbac`</h3>
 *
 * The nav label an operator reads is "Roles & permissions", and an acronym in a URL is a term of
 * art from the schema rather than from the product. Nothing linked to the old path — it was a
 * `comingSoon` entry with no page behind it — so there is no redirect to maintain.
 */
export default function PlatformAccessPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Roles & permissions"
        description="Every permission this product defines and every role that grants one. The platform tier can read this and cannot change it."
      />

      <PermissionMatrix />
    </div>
  );
}

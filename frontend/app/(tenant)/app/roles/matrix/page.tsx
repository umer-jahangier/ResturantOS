"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ShieldQuestion } from "lucide-react";

import { RecentAuditDigest } from "@/components/audit/recent-audit-digest";
import { PermissionMatrix } from "@/components/roles/permission-matrix";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { usePermissionCatalogue } from "@/lib/hooks/use-roles";
import { useAssignableRoles } from "@/lib/hooks/use-users";
import { formatNumber } from "@/lib/format/locale";

/**
 * URL: `/app/roles/matrix` — the access matrix (N6 + N7).
 *
 * <h2>Why a route and not a tab on `/app/roles`</h2>
 *
 * <p>`/app/roles` is where roles are BUILT: it holds the create/edit/delete affordances, a
 * confirm dialog, and a picker that writes. This is a READ view of the same catalogue, and the
 * two want different things from a URL. An administrator comparing nine roles wants to send
 * someone the comparison — "look at what FINANCE_VIEWER actually holds" is a link, not a tab
 * state — and a reader who only reviews access should never land on a screen whose primary
 * action deletes a role. Editing stays in the picker; nothing on this page writes.
 *
 * <h2>The gate is the READ gate, and it is deliberately the same one `/app/roles` uses</h2>
 *
 * <p>Reading the catalogue takes any of the three administration codes. `rbac.role.manage` is
 * NOT required here, because composing a role and reading who holds what are different acts —
 * that split is 13-07's, and re-deciding it on a second screen is how two surfaces come to
 * disagree about who may look.
 *
 * <h2>The audit digest is on this page on purpose</h2>
 *
 * <p>The demo puts its RBAC matrix and its audit log on one screen (`#screen-admin`), and the
 * pairing is right for a reason the demo does not state: a permission matrix answers *who can do
 * this*, and the only follow-up question is *who has been changing it*. The digest is gated
 * separately on `audit.log.view` — it is seeded to OWNER and TENANT_ADMIN only, so a caller
 * holding `rbac.user.manage` alone gets the matrix and no 403 panel underneath it.
 *
 * <h2>Withheld roles are stated, because a matrix with a missing column is a wrong matrix</h2>
 *
 * <p>`GET /api/v1/roles` filters by the caller's ceiling and reports how many rows it withheld.
 * On a card grid a missing card is merely absent; on a matrix a missing COLUMN silently changes
 * what the reader concludes about every row. The count is surfaced, never the names (13-07:
 * naming them republishes exactly what the ceiling withholds).
 */
export default function PermissionMatrixPage() {
  const { permissions } = useCurrentUser();
  const canRead =
    permissions.includes("rbac.manage") ||
    permissions.includes("rbac.user.manage") ||
    permissions.includes("rbac.role.manage");
  const canReadAudit = permissions.includes("audit.log.view");

  const rolesQuery = useAssignableRoles(canRead);
  const catalogueQuery = usePermissionCatalogue(canRead);

  const roles = useMemo(() => rolesQuery.data?.roles ?? [], [rolesQuery.data]);
  const modules = useMemo(() => catalogueQuery.data ?? [], [catalogueQuery.data]);
  const withheld = rolesQuery.data?.withheldMessage ?? null;
  const permissionCount = modules.reduce((sum, group) => sum + group.permissions.length, 0);

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Permission matrix"
          description="Every permission in this product, against every role that can hold it."
        />
        <EmptyState
          icon={ShieldQuestion}
          title="You don't administer roles"
          description="The matrix shows what every member of staff may do, so only an owner or a tenant administrator can read it. Ask one of them if you need to check an access question."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permission matrix"
        description="Every permission this product understands, against every role you may administer. Read it down a column to see what a role can do, or across a row to see who else can do one thing."
        meta={
          modules.length > 0 ? (
            <>
              {formatNumber(roles.length)} {roles.length === 1 ? "role" : "roles"} ·{" "}
              {formatNumber(permissionCount)} permissions · {formatNumber(modules.length)} modules
            </>
          ) : undefined
        }
        actions={
          <Button type="button" variant="outline" asChild>
            <Link href="/app/roles">Back to roles</Link>
          </Button>
        }
      />

      {withheld && (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body text-foreground"
        >
          {withheld} Those roles are not columns below, so this matrix is not the whole picture.
        </p>
      )}

      {/*
       * BOTH queries, as a unit. The rows come from the catalogue and the columns from the roles;
       * a matrix drawn from one of them is not a partial matrix, it is a wrong one — every empty
       * cell would read as "not granted" when it actually means "not loaded".
       */}
      <QueryBoundary
        query={[rolesQuery, catalogueQuery]}
        what="the roles and the permission catalogue"
        moduleLabel="Roles"
        isEmpty={roles.length === 0 || modules.length === 0}
        loading={<Skeleton className="h-96" />}
        empty={
          <EmptyState
            icon={ShieldQuestion}
            title="Nothing to compare yet"
            description="A matrix needs both axes: the roles you may administer, and the permission catalogue they draw from. One of them came back empty, so there is nothing to lay out."
          />
        }
      >
        <PermissionMatrix roles={roles} modules={modules} />
      </QueryBoundary>

      {canReadAudit && <RecentAuditDigest title="Latest activity" />}
    </div>
  );
}

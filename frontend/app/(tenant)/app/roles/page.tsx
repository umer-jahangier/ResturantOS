"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useAssignableRoles } from "@/lib/hooks/use-users";
import { usePermissionCatalogue, useDeleteRole } from "@/lib/hooks/use-roles";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { AssignableRole } from "@/lib/models/user.model";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RoleList } from "@/components/roles/role-list";
import { RoleBuilderDialog } from "@/components/roles/role-builder-dialog";
import { RoleDetailDialog } from "@/components/roles/role-detail-dialog";

/**
 * URL: `/app/roles` — the role builder (S3).
 *
 * <h3>What was here before</h3>
 *
 * <p>`404 This page doesn't exist`, for the OWNER. The only role surface in the product was
 * Users → Assign role: two selects, zero checkboxes, over a fixed list of eight. There was no
 * permission picker, no role creation, and no way for anybody to see what a role granted.
 * `FEATURE_CUSTOM_ROLES` was one of twenty platform toggles and switching it on changed nothing,
 * because no screen consumed it.
 *
 * <h3>The read side already existed and had for months</h3>
 *
 * <p>`GET /api/v1/roles` returns the ceiling-filtered roles with the codes each grants, and
 * `GET /api/v1/permissions` returns the 76-code vocabulary in 13 modules. This screen consumes
 * both, and adds nothing to them client-side: it never hardcodes a role list, never filters the
 * catalogue further, and never re-derives the module grouping. Doing any of those would put a
 * second, weaker copy of an authorization rule in the one place an attacker controls.
 *
 * <h3>Two gates, deliberately different</h3>
 *
 * <p>READING the catalogue takes the user-administration code, because a screen that lists people
 * has to render the role each holds. WRITING takes `rbac.role.manage` — composing a role IS
 * granting authority. So the page renders for a caller who may only read, with the write controls
 * simply absent rather than present-and-403ing.
 *
 * <h3>Error before empty</h3>
 *
 * <p>Via {@code QueryBoundary}, which takes the query rather than three booleans precisely so a
 * failed read cannot be rendered as "you have no roles" — the defect that made eleven list screens
 * tell owners their business had no vendors.
 */
export default function RolesPage() {
  const { permissions } = useCurrentUser();
  const canRead =
    permissions.includes("rbac.manage") ||
    permissions.includes("rbac.user.manage") ||
    permissions.includes("rbac.role.manage");
  const canManage =
    permissions.includes("rbac.manage") || permissions.includes("rbac.role.manage");

  const rolesQuery = useAssignableRoles(canRead);
  const catalogueQuery = usePermissionCatalogue(canRead);
  const deleteRole = useDeleteRole();

  const [builderTarget, setBuilderTarget] = useState<
    { mode: "create" } | { mode: "edit"; role: AssignableRole } | null
  >(null);
  const [inspecting, setInspecting] = useState<AssignableRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssignableRole | null>(null);

  const roles = useMemo(() => rolesQuery.data?.roles ?? [], [rolesQuery.data]);
  const modules = useMemo(() => catalogueQuery.data ?? [], [catalogueQuery.data]);
  const withheld = rolesQuery.data?.withheldMessage ?? null;
  const customCount = roles.filter((role) => !role.system).length;

  function confirmDelete() {
    const role = deleteTarget;
    if (!role) return;
    deleteRole.mutate(role.code, {
      onSuccess: () => {
        toast.success(`Deleted ${role.name}`);
        setDeleteTarget(null);
      },
      // 409 ROLE_IN_USE arrives as the server's own sentence counting the holders. Shown as a
      // toast because the confirmation dialog has nothing the operator can correct — the fix is on
      // the Users screen.
      onError: (e) => toast.error(e.message || "Could not delete the role."),
    });
  }

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Roles"
          description="What each role in this restaurant is allowed to do."
        />
        <EmptyState
          icon={ShieldCheck}
          title="You don't administer roles"
          description="Roles decide what every member of staff may do, so only an owner or a tenant administrator can see and change them. Ask one of them if you need a new role."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="What each role in this restaurant is allowed to do. Open one to read every permission it grants; build your own when the eight built-in roles do not match how you actually work."
        meta={
          <>
            {roles.length} {roles.length === 1 ? "role" : "roles"} · {customCount} of them yours
          </>
        }
        actions={
          canManage ? (
            <Button type="button" onClick={() => setBuilderTarget({ mode: "create" })}>
              New role
            </Button>
          ) : undefined
        }
      />

      {withheld && (
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body text-foreground"
        >
          {withheld}
        </p>
      )}

      <QueryBoundary
        query={rolesQuery}
        what="the roles in this restaurant"
        moduleLabel="Roles"
        isEmpty={roles.length === 0}
        loading={
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        }
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No roles you can administer"
            description="Every role in this restaurant grants at least one permission you do not hold yourself, so none of them is yours to change. An owner can see the full list."
          />
        }
      >
        <RoleList
          roles={roles}
          canManage={canManage}
          onInspect={setInspecting}
          onEdit={(role) => setBuilderTarget({ mode: "edit", role })}
          onDelete={setDeleteTarget}
        />
      </QueryBoundary>

      {/*
       * The catalogue is loaded alongside the roles and is what turns a list of codes into
       * something readable. Its failure is reported separately rather than folded into the roles
       * error: the list is perfectly usable without descriptions, and hiding the roles because
       * their captions failed would be the larger lie.
       */}
      {catalogueQuery.isError && (
        <p role="alert" className="text-body text-destructive">
          Couldn&rsquo;t load the permission catalogue, so permissions will show as bare codes with
          no descriptions.{" "}
          <button
            type="button"
            onClick={() => void catalogueQuery.refetch()}
            className="font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      )}

      <RoleDetailDialog
        role={inspecting}
        modules={modules}
        open={inspecting !== null}
        onOpenChange={(next) => {
          if (!next) setInspecting(null);
        }}
        onEdit={
          canManage && inspecting && !inspecting.system
            ? () => {
                const role = inspecting;
                setInspecting(null);
                setBuilderTarget({ mode: "edit", role });
              }
            : undefined
        }
      />

      <RoleBuilderDialog
        key={
          builderTarget
            ? builderTarget.mode === "edit"
              ? `edit-${builderTarget.role.code}`
              : "create"
            : "role-builder-idle"
        }
        role={builderTarget?.mode === "edit" ? builderTarget.role : undefined}
        modules={modules}
        open={builderTarget !== null}
        onOpenChange={(next) => {
          if (!next) setBuilderTarget(null);
        }}
      />

      {/*
        38-10 task 5: the shared ConfirmDialog. Deleting a role is the most destructive action on
        this screen and it was the one place still hand-rolling the dialog — so the confirm button
        rendered in the DEFAULT tone while /app/branches, three clicks away, painted a merely
        reversible deactivation in destructive red. Same primitive now, same tone ladder.

        The holder-count sentence is preserved verbatim: it is the only place the operator is told
        WHY the server is about to refuse them, and the fix for that refusal is on another screen.
      */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "role"}?`}
        body={
          deleteTarget && deleteTarget.assignedUserCount > 0 ? (
            <>
              {deleteTarget.assignedUserCount}{" "}
              {deleteTarget.assignedUserCount === 1 ? "person holds" : "people hold"} this role.
              Move them to another role on the Users screen first — deleting it now will be
              refused, because they would keep signing in and find every screen missing.
            </>
          ) : (
            <>Nobody holds this role, so nothing changes for anyone. This cannot be undone.</>
          )
        }
        confirmLabel="Delete role"
        pendingLabel="Deleting…"
        onConfirm={confirmDelete}
        isPending={deleteRole.isPending}
      />
    </div>
  );
}

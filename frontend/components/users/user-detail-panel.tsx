"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldPlus, UserMinus, UserRoundCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdminResetDialog } from "@/components/users/admin-reset-dialog";
import { AssignRoleDialog } from "@/components/users/assign-role-dialog";
import { EditUserDialog } from "@/components/users/user-form-dialog";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDeactivateUser, useReactivateUser, useUserDetail } from "@/lib/hooks/use-users";
import { useTenantBranches } from "@/lib/hooks/use-tenant-settings";
import { formatUserFacingError } from "@/lib/errors";
import { formatPaisa } from "@/lib/adapters/shared";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Everything about one user, and every action that can be taken on them.
 *
 * <h3>Permission gating</h3>
 *
 * No control is rendered that the caller's permissions forbid. The user lifecycle verbs are gated
 * on `rbac.manage | rbac.user.manage`; role assignment is gated on `rbac.manage | rbac.role.manage`,
 * which is a DIFFERENT code by design (13-02) — gating role writes on the user-administration code
 * would mean anyone able to edit a user could grant themselves OWNER. Both gates are read here
 * separately for that reason, rather than collapsed into one "is an admin" boolean that would
 * quietly re-merge the split the backend went to some trouble to make.
 *
 * <h3>An empty assignment list is a state, not an empty table</h3>
 *
 * An account with no branch role cannot sign in at all. That is said in words, with the action that
 * fixes it next to it — an empty region under a "Roles" heading reads as a rendering gap.
 */
export function UserDetailPanel({ userId }: { userId: string | null }) {
  const detail = useUserDetail(userId);
  const branches = useTenantBranches(Boolean(userId));
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const { permissions, userId: currentUserId } = useCurrentUser();

  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const canAdministerUsers =
    permissions.includes("rbac.manage") || permissions.includes("rbac.user.manage");
  const canAssignRoles =
    permissions.includes("rbac.manage") || permissions.includes("rbac.role.manage");

  if (!userId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Choose someone from the list to see their roles and manage their account.
        </CardContent>
      </Card>
    );
  }

  const user = detail.data?.user;
  const assignments = detail.data?.assignments ?? [];
  const branchName = (branchId: string) =>
    branches.data?.find((b) => b.id === branchId)?.name ?? branchId;

  // Deactivating yourself revokes your own sessions mid-click. The API permits it; offering it is
  // still a trap, so the control is withheld and the reason is stated where the control would be.
  const isSelf = user?.id === currentUserId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user ? (user.fullName ?? user.email) : "User"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <QueryBoundary query={detail} what="this user">
          {user && (
            <>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Email">
                  <span className="break-all">{user.email}</span>
                </Field>
                <Field label="Status">
                  <StatusBadge
                    status={user.active ? "active" : "inactive"}
                    label={user.active ? "Active" : "Deactivated"}
                  />
                </Field>
                <Field label="Two-factor">{user.totpEnabled ? "Enrolled" : "Not enrolled"}</Field>
                <Field label="Password">
                  {user.mustChangePassword ? "Must be changed at next sign-in" : "Set by the user"}
                </Field>
              </dl>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Roles by branch</h3>
                {assignments.length === 0 ? (
                  <p className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                    This account holds no role on any branch, so it cannot sign in. Assign a role to
                    finish setting it up.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {assignments.map((a) => (
                      <li
                        key={`${a.branchId}-${a.roleCode}`}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{branchName(a.branchId)}</span>
                        {/*
                          The approval limit in force, in words rather than an empty cell. An
                          absent limit denies every amount-gated action at any amount, so rendering
                          nothing there would read as a rendering gap for the single most
                          consequential fact on the row — which is the class of defect 14b spent a
                          phase closing.
                        */}
                        <span
                          className="shrink-0 text-xs text-muted-foreground"
                          data-testid={`approval-limit-${a.branchId}`}
                        >
                          {a.approvalLimitPaisa === null || a.approvalLimitPaisa === undefined
                            ? "No approval authority"
                            : `Approves up to ${formatPaisa(a.approvalLimitPaisa)}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {a.primary && (
                            <span className="text-xs text-muted-foreground">primary</span>
                          )}
                          <StatusBadge status="active" label={a.roleCode} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                {canAdministerUsers && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit
                  </Button>
                )}

                {canAssignRoles && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAssignOpen(true)}
                  >
                    <ShieldPlus className="size-3.5" aria-hidden="true" />
                    Assign role
                  </Button>
                )}

                {canAdministerUsers && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setResetOpen(true)}
                  >
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    Reset password
                  </Button>
                )}

                {canAdministerUsers &&
                  !isSelf &&
                  (user.active ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={deactivate.isPending}
                      onClick={() =>
                        deactivate.mutate(user.id, {
                          onSuccess: () =>
                            toast.success(
                              `${user.email} has been deactivated and signed out everywhere.`,
                            ),
                          onError: (error) => toast.error(formatUserFacingError(error)),
                        })
                      }
                    >
                      <UserMinus className="size-3.5" aria-hidden="true" />
                      {deactivate.isPending ? "Deactivating…" : "Deactivate"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={reactivate.isPending}
                      onClick={() =>
                        reactivate.mutate(user.id, {
                          onSuccess: () => toast.success(`${user.email} can sign in again.`),
                          onError: (error) => toast.error(formatUserFacingError(error)),
                        })
                      }
                    >
                      <UserRoundCheck className="size-3.5" aria-hidden="true" />
                      {reactivate.isPending ? "Reactivating…" : "Reactivate"}
                    </Button>
                  ))}
              </div>

              {canAdministerUsers && isSelf && (
                <p className="text-xs text-muted-foreground">
                  You cannot deactivate your own account here — it would sign you out mid-action.
                  Ask another administrator.
                </p>
              )}

              <EditUserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />
              <AdminResetDialog user={user} open={resetOpen} onOpenChange={setResetOpen} />
              <AssignRoleDialog
                user={user}
                open={assignOpen}
                onOpenChange={setAssignOpen}
                defaultBranchId={assignments[0]?.branchId ?? null}
              />
            </>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldMinus, ShieldPlus, UserMinus, UserRoundCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { QueryBoundary, QueryErrorNotice } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdminResetDialog } from "@/components/users/admin-reset-dialog";
import { AssignRoleDialog } from "@/components/users/assign-role-dialog";
import { EditUserDialog } from "@/components/users/user-form-dialog";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  useDeactivateUser,
  useReactivateUser,
  useRevokeBranchRole,
  useUserDetail,
  useUserMenuCategories,
  useUserStations,
} from "@/lib/hooks/use-users";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import { useMenuCategoriesAdmin } from "@/lib/hooks/pos/use-menu-admin";
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
 *
 * <h3>Revoke lives on the row, not in a dialog of its own (S2)</h3>
 *
 * A grant used to be permanent from this screen: the endpoint has worked since 13-02 and no control
 * anywhere called it, so a promoted, demoted or transferred employee kept their old branch access
 * for good. The control is per-ROW because the thing being taken away is one row — a person can
 * hold a different role at every branch they work, and a single "Revoke" button at the bottom of
 * the panel would have to ask which one, re-deriving in a form what the list already shows.
 */
export function UserDetailPanel({ userId }: { userId: string | null }) {
  const detail = useUserDetail(userId);
  const branches = useTenantBranches(Boolean(userId));
  const stationScope = useUserStations(userId);
  const stations = useStations();
  const menuScope = useUserMenuCategories(userId);
  const menuCategories = useMenuCategoriesAdmin();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const revoke = useRevokeBranchRole();
  const { permissions, userId: currentUserId } = useCurrentUser();

  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<{
    branchId: string;
    roleCode: string;
  } | null>(null);

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
  // The code is the routing key and the only thing stored; the NAME is what an operator recognises.
  // Only the signed-in branch's stations can be listed (the endpoint refuses any other branch), so
  // a code from another branch falls back to itself rather than being hidden.
  const stationName = (code: string) =>
    stations.data?.find((s) => s.code === code)?.name ?? code;
  // Same fallback, same reason: the id is what is stored and the name is what an owner recognises.
  // A category deleted out from under an assignment renders as its id rather than vanishing —
  // a scope entry that is invisible here is one nobody knows to clear.
  const menuCategoryName = (categoryId: string) =>
    menuCategories.data?.find((c) => c.id === categoryId)?.name ?? categoryId;

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
                    {/*
                      The branch name gets a line of its own AT EVERY WIDTH, and the row below it
                      wraps.

                      Adding the Revoke control put four things on one line and the geometry was
                      measured rather than eyeballed (`e2e/s2-revoke-responsive.mjs`, results in
                      `_responsive.json`). At 390 the row overflowed its card outright — the branch
                      name squeezed to "F..", the button clipped mid-word to "Revok". Breaking the
                      name onto its own line below `sm` fixed 390 and 768 and left 1440 still
                      truncating "Floating Terrace — Rooftop" to an ellipsis, because the thing that
                      is short of room is the CARD, not the viewport, and this panel sits in a
                      two-column page at every desktop width. A viewport breakpoint cannot express
                      that. Rather than reach for a container query on a layout ancestor, the row is
                      simply always two lines: it costs a few pixels of height on a list that is
                      rarely more than three rows, and the branch name — which is the row's identity
                      and the thing the Revoke button's accessible name quotes — is never hidden.

                      `break-words`, not `truncate`: an ellipsis on the identifying field is the
                      defect this is fixing, so a pathological name wraps instead of disappearing.
                    */}
                    {assignments.map((a) => (
                      <li
                        key={`${a.branchId}-${a.roleCode}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 basis-full font-medium break-words">
                          {branchName(a.branchId)}
                        </span>
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
                        <span className="ml-auto flex shrink-0 items-center gap-2">
                          {a.primary && (
                            <span className="text-xs text-muted-foreground">primary</span>
                          )}
                          <StatusBadge status="active" label={a.roleCode} />
                          {/*
                            Gated on the ROLE authority, not the user one — the same split the
                            Assign button reads, because revoking is the other half of the same
                            write and the server gates both on `rbac.role.manage`.

                            The accessible name carries the role AND the branch. An icon-only
                            button labelled "Revoke" appears four times identically on a user who
                            works four branches, and the row it belongs to is a visual fact only.
                          */}
                          {canAssignRoles && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Revoke ${a.roleCode} at ${branchName(a.branchId)}`}
                              data-testid={`revoke-role-${a.branchId}-${a.roleCode}`}
                              disabled={revoke.isPending}
                              onClick={() =>
                                setPendingRevoke({ branchId: a.branchId, roleCode: a.roleCode })
                              }
                            >
                              <ShieldMinus className="size-3.5" aria-hidden="true" />
                              Revoke
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/*
                28-11. Rendered as a SENTENCE when there is no assignment, not as a blank region
                or the word "none". Every user in this product is unassigned, and unassigned means
                they see every station — presenting the universal default as an absence is how an
                admin concludes something is broken and "fixes" it into a restriction nobody
                wanted. The panel already treats "holds no role" as a state in its own right for
                exactly this reason.
              */}
              <section className="space-y-2" data-testid="user-station-scope">
                <h3 className="text-sm font-medium">Stations</h3>
                {stationScope.isError ? (
                  <QueryErrorNotice
                    what="this user's stations"
                    error={stationScope.error}
                    onRetry={() => void stationScope.refetch()}
                    isRetrying={stationScope.isFetching}
                  />
                ) : stationScope.isPending ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : stationScope.data?.unrestrictedEverywhere ? (
                  <p className="text-sm text-muted-foreground">
                    Sees every station in every branch they work.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(stationScope.data?.branches ?? []).map((b) => (
                      <li
                        key={b.branchId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{branchName(b.branchId)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {b.stationCodes.map((code) => stationName(code)).join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/*
                Program A. Same shape and same rule as the station block above, and the sentence
                matters more here: this is the boundary the owner asked for, and the state it is in
                for every user in the product today is "no rows". Rendering that as a blank region
                or the word "none" would present the permissive default as a lockout, on the one
                screen where an owner would act on it.

                It is a READ-ONLY report — the write lives in the Edit dialog, behind
                `rbac.role.manage`, while this panel is behind `rbac.user.manage`. A tenant admin
                holds both, but the split is what stops a narrower custom role from being able to
                confine a cashier just because it can look one up.
              */}
              <section className="space-y-2" data-testid="user-menu-category-scope">
                <h3 className="text-body font-medium">Menu sections</h3>
                {menuScope.isError ? (
                  <QueryErrorNotice
                    what="this user's menu sections"
                    error={menuScope.error}
                    onRetry={() => void menuScope.refetch()}
                    isRetrying={menuScope.isFetching}
                  />
                ) : menuScope.isPending ? (
                  <p className="text-body text-muted-foreground">Loading…</p>
                ) : menuScope.data?.unrestrictedEverywhere ? (
                  <p
                    data-testid="user-menu-category-unrestricted"
                    className="text-body text-muted-foreground"
                  >
                    Can ring the whole menu, in every branch they work.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(menuScope.data?.branches ?? []).map((b) => (
                      <li
                        key={b.branchId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-body"
                      >
                        <span className="min-w-0 flex-1 truncate">{branchName(b.branchId)}</span>
                        <span className="shrink-0 text-small text-muted-foreground">
                          {b.categoryIds.map((id) => menuCategoryName(id)).join(", ")}
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

              {/*
                The confirmation NAMES the role and the branch in its title, because that is the
                pair being destroyed and the panel may show several rows that differ only in one of
                them. The body states the consequence rather than asking "are you sure": what the
                person loses, when it takes effect, and — when this is their last active assignment
                — that the account stops being able to sign in at all, which is the one outcome an
                administrator would not predict from the word "revoke".
              */}
              {pendingRevoke && (
                <ConfirmDialog
                  open
                  onOpenChange={(next) => {
                    if (!next) {
                      setPendingRevoke(null);
                      revoke.reset();
                    }
                  }}
                  title={`Revoke ${pendingRevoke.roleCode} at ${branchName(pendingRevoke.branchId)}?`}
                  body={
                    <>
                      {user.fullName ?? user.email} loses every permission that role carries at{" "}
                      {branchName(pendingRevoke.branchId)}, including access to that branch&apos;s
                      orders, tills and reports.{" "}
                      {assignments.length === 1 ? (
                        <strong>
                          It is their only role, so the account will no longer be able to sign in
                          until another role is assigned.
                        </strong>
                      ) : (
                        <>Their roles at other branches are untouched.</>
                      )}{" "}
                      If they are signed in right now, it applies the next time their session
                      refreshes.
                    </>
                  }
                  confirmLabel="Revoke role"
                  pendingLabel="Revoking…"
                  isPending={revoke.isPending}
                  error={revoke.isError ? formatUserFacingError(revoke.error) : undefined}
                  onConfirm={() => {
                    const target = pendingRevoke;
                    revoke.mutate(
                      {
                        userId: user.id,
                        branchId: target.branchId,
                        roleCode: target.roleCode,
                      },
                      {
                        onSuccess: () => {
                          setPendingRevoke(null);
                          revoke.reset();
                          toast.success(
                            `${target.roleCode} revoked at ${branchName(target.branchId)} for ${user.email}.`,
                          );
                        },
                        // Deliberately NOT a toast, and the dialog deliberately stays open. The
                        // refusal this most often meets is 403 ROLE_CEILING_EXCEEDED — you may only
                        // take back a role you could have granted — and a toast over a closed
                        // dialog leaves an administrator looking at an unchanged list with no
                        // explanation of why.
                      },
                    );
                  }}
                />
              )}
            </>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

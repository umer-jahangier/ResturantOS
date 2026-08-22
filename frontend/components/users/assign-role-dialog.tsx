"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { RoleSelect } from "@/components/users/role-select";
import {
  ApprovalLimitField,
  type ApprovalLimitValue,
  approvalLimitPayloadValue,
  isApprovalLimitDecided,
  roleNeedsApprovalLimit,
} from "@/components/users/approval-limit-field";
import {
  useApplyApprovalLimitToRoleHolders,
  useAssignBranchRole,
  useAssignableRoles,
} from "@/lib/hooks/use-users";
import { useTenantBranches } from "@/lib/hooks/use-tenant-settings";
import { formatUserFacingError } from "@/lib/errors";
import type { TenantUser } from "@/lib/models/user.model";

/**
 * When a limit change reaches the policy engine.
 *
 * `PermissionResolver` reads `approval_limit_paisa` off the branch-role row and folds it into the
 * token's `attributes` at sign-in and at refresh. A user already signed in keeps the OLD value in
 * their existing token until it is replaced. Saying so is not a caveat — it is the difference
 * between an owner who waits a minute and an owner who concludes the feature does not work.
 *
 * This screen deliberately does NOT revoke the affected user's sessions to force the change
 * through. Forcing a sign-out on a limit change is a policy decision with its own argument and a
 * change to another team's session model.
 */
const TAKES_EFFECT_NOTE = "It applies the next time that user signs in or their session refreshes.";

/**
 * Assign a role on a branch.
 *
 * <h3>The displacement warning is the point of this dialog</h3>
 *
 * A user holds ONE active role per branch (13-02). Assigning a second therefore silently removes
 * the first, and the API says so in the response's `displacedRoleCode`. The only way an admin can
 * know they have just demoted someone is if that field is surfaced, so the success toast names it
 * explicitly rather than saying "Role assigned" and moving on.
 *
 * <h3>Where the refusals come from</h3>
 *
 * This endpoint is gated on `rbac.role.manage`, NOT the user-administration code — the split exists
 * so that being able to edit a user is not by itself enough to grant yourself OWNER. A role above
 * the caller's ceiling is refused with 403 `ROLE_CEILING_EXCEEDED` and writes nothing. The picker
 * already withholds such roles, so reaching that refusal through this form means something moved
 * server-side between the two calls; it is reported as the server worded it rather than translated
 * into a guess.
 */
export function AssignRoleDialog({
  user,
  open,
  onOpenChange,
  defaultBranchId,
}: {
  user: TenantUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBranchId?: string | null;
}) {
  const assign = useAssignBranchRole();
  const bulkApply = useApplyApprovalLimitToRoleHolders();
  const branches = useTenantBranches(open);
  const catalog = useAssignableRoles();
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [roleCode, setRoleCode] = useState("");
  const [limit, setLimit] = useState<ApprovalLimitValue>({ kind: "unset" });

  // Whether this role needs a limit is decided by the role's OWN permission list, which the roles
  // endpoint already returns. Never by role code — a tenant's custom role holding
  // `vendor.po.approve` needs the field exactly as much as MANAGER does.
  const selectedRole = (catalog.data?.roles ?? []).find((r) => r.code === roleCode);
  const needsLimit = roleNeedsApprovalLimit(selectedRole?.permissions);
  const limitDecided = !needsLimit || isApprovalLimitDecided(limit);

  function close() {
    onOpenChange(false);
    setRoleCode("");
    setLimit({ kind: "unset" });
    assign.reset();
  }

  // A role change RESETS the limit decision rather than carrying it forward. An unexamined limit
  // surviving a role change is how a demoted user keeps spending authority — and the server writes
  // whatever this request carries, unconditionally, so a stale value here becomes a stale grant.
  function chooseRole(next: string) {
    setRoleCode(next);
    setLimit({ kind: "unset" });
  }

  function applyToEveryHolder() {
    if (!branchId || !roleCode || !limitDecided) return;
    bulkApply.mutate(
      { branchId, roleCode, approvalLimitPaisa: approvalLimitPayloadValue(limit) },
      {
        onSuccess: (outcomes) => {
          const applied = outcomes.filter((o) => o.ok);
          const refused = outcomes.filter((o) => !o.ok);
          if (outcomes.length === 0) {
            toast.info(`Nobody currently holds ${roleCode} at this branch.`);
            return;
          }
          if (refused.length === 0) {
            toast.success(
              `Limit applied to ${applied.length} ${roleCode} ${
                applied.length === 1 ? "holder" : "holders"
              }. ${TAKES_EFFECT_NOTE}`,
            );
            return;
          }
          // Named, never dropped: "applied" while some holders still cannot approve anything is the
          // exact lie this phase exists to stop telling.
          toast.warning(
            `Limit applied to ${applied.length} of ${outcomes.length}. Not applied to: ${refused
              .map((o) => `${o.email} (${o.error})`)
              .join("; ")}`,
          );
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !branchId || !roleCode || !limitDecided) return;
    assign.mutate(
      {
        userId: user.id,
        payload: {
          branchId,
          roleCode,
          // Sent on every assignment of a role that needs one — including as an explicit null, so
          // "no approval authority" is a decision the server records rather than a field omitted.
          ...(needsLimit ? { approvalLimitPaisa: approvalLimitPayloadValue(limit) } : {}),
        },
      },
      {
        onSuccess: (written) => {
          const limitClause = needsLimit
            ? limit.kind === "none"
              ? " No approval authority."
              : ` Approval limit set.`
            : "";
          if (written.displacedRoleCode) {
            toast.success(
              `${roleCode} assigned. This replaced ${written.displacedRoleCode} on that branch — a user holds one role per branch.${limitClause} ${TAKES_EFFECT_NOTE}`,
            );
          } else if (written.roleCode === roleCode && needsLimit) {
            // Re-submitting the same role at the same branch UPDATES the row rather than
            // displacing anything (BranchRoleAdminService.assign). Saying "assigned" would imply a
            // re-grant that did not happen.
            toast.success(`${roleCode} approval limit updated.${limitClause} ${TAKES_EFFECT_NOTE}`);
          } else {
            toast.success(`${roleCode} assigned.${limitClause} ${TAKES_EFFECT_NOTE}`);
          }
          close();
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign a role to {user.email}</DialogTitle>
          <DialogDescription>
            A user holds one role per branch. Assigning a role on a branch they already work at
            replaces the role they had there.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-branch">Branch</Label>
            {branches.isError ? (
              <QueryErrorNotice
                what="your branches"
                error={branches.error}
                onRetry={() => void branches.refetch()}
                isRetrying={branches.isFetching}
              />
            ) : (
              <select
                id="assign-branch"
                value={branchId}
                disabled={branches.isPending}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-small transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-surface-2"
              >
                <option value="">Choose a branch…</option>
                {(branches.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isHq ? " (HQ)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assign-role">Role</Label>
            <RoleSelect
              id="assign-role"
              value={roleCode}
              onChange={chooseRole}
              includeEmptyOption
              emptyOptionLabel="Choose a role…"
            />
          </div>

          {needsLimit && (
            <ApprovalLimitField
              id="assign-approval-limit"
              value={limit}
              onChange={setLimit}
              roleLabel={roleCode}
            />
          )}

          {needsLimit && !limitDecided && (
            <p className="text-label text-muted-foreground" data-testid="assign-limit-required">
              {roleCode} can approve spending, so an approval limit is required. Enter an amount, or
              choose no approval authority.
            </p>
          )}

          {/*
            The bulk path is a SECONDARY action inside this dialog, not a screen of its own: the
            role, the branch and the limit are already chosen here, and a separate screen would mean
            choosing them twice. Every write it makes goes through the same mutation and the same
            endpoint as the single assignment above.
          */}
          {needsLimit && limitDecided && branchId && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkApply.isPending}
                onClick={applyToEveryHolder}
                data-testid="apply-limit-to-all-holders"
              >
                {bulkApply.isPending
                  ? "Applying…"
                  : `Apply this limit to every ${roleCode} at this branch`}
              </Button>
              <p className="mt-1.5 text-label text-muted-foreground">
                One assignment per holder, through the same endpoint and the same ceiling check as a
                single assignment. Anyone you may not assign {roleCode} to is named rather than
                skipped quietly.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={assign.isPending || !branchId || !roleCode || !limitDecided}
            >
              {assign.isPending ? "Assigning…" : "Assign role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

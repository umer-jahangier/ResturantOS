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
import { useAssignBranchRole } from "@/lib/hooks/use-users";
import { useTenantBranches } from "@/lib/hooks/use-tenant-settings";
import { formatUserFacingError } from "@/lib/errors";
import type { TenantUser } from "@/lib/models/user.model";

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
  const branches = useTenantBranches(open);
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [roleCode, setRoleCode] = useState("");

  function close() {
    onOpenChange(false);
    setRoleCode("");
    assign.reset();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !branchId || !roleCode) return;
    assign.mutate(
      { userId: user.id, payload: { branchId, roleCode } },
      {
        onSuccess: (written) => {
          if (written.displacedRoleCode) {
            toast.success(
              `${roleCode} assigned. This replaced ${written.displacedRoleCode} on that branch — a user holds one role per branch.`,
            );
          } else {
            toast.success(`${roleCode} assigned.`);
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
      <DialogContent className="sm:max-w-md">
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
                className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-sm transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-surface-2"
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
              onChange={setRoleCode}
              includeEmptyOption
              emptyOptionLabel="Choose a role…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={assign.isPending || !branchId || !roleCode}>
              {assign.isPending ? "Assigning…" : "Assign role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { ShieldCheck } from "lucide-react";

import type { PermissionModule } from "@/lib/models/role.model";
import type { AssignableRole } from "@/lib/models/user.model";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PermissionPicker } from "@/components/roles/permission-picker";

/**
 * What a role grants, grouped by module — the answer the product could not give at all.
 *
 * <p>The register's exact finding: "there is no permission picker, no role creation, no role
 * cloning, no per-role permission view — <b>nowhere in the product can anyone see what a role
 * actually grants</b>". This is that view, and it works for a built-in role and a custom one alike,
 * because the question is the same one.
 *
 * <p>It renders the SAME component the builder does, in read-only mode. A separate viewer would be
 * a second rendering of "what does this grant" and the two would eventually disagree.
 */
export function RoleDetailDialog({
  role,
  modules,
  open,
  onOpenChange,
  onEdit,
}: {
  role: AssignableRole | null;
  modules: PermissionModule[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent for a built-in role, or for a caller without role-administration authority. */
  onEdit?: () => void;
}) {
  if (!role) return null;

  const holders = role.assignedUserCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(100vw-1.5rem,42rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {role.name}
            <code className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-small text-foreground-tertiary">
              {role.code}
            </code>
          </DialogTitle>
          <DialogDescription>
            {role.system ? (
              <>
                A built-in role. Its permissions are the same on every installation and cannot be
                changed — build your own role if you need a different set.
              </>
            ) : (
              <>A role this restaurant defined.</>
            )}{" "}
            Grants {role.permissions.length}{" "}
            {role.permissions.length === 1 ? "permission" : "permissions"}, held by {holders}{" "}
            {holders === 1 ? "person" : "people"}.
          </DialogDescription>
        </DialogHeader>

        <div data-testid="role-permission-view">
          {role.permissions.length === 0 ? (
            <p
              role="status"
              className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center text-body text-muted-foreground"
            >
              <ShieldCheck aria-hidden="true" className="size-6" />
              This role grants nothing at all. Anyone holding it can sign in and will find every
              screen missing.
            </p>
          ) : (
            <PermissionPicker
              modules={modules}
              selected={role.permissions}
              readOnly
              idPrefix={`view-${role.code}`}
            />
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              Edit permissions
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

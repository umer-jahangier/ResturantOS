"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useCreateRole, useUpdateRole } from "@/lib/hooks/use-roles";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PermissionPicker } from "@/components/roles/permission-picker";

/**
 * Compose a role: a name and a set of ticked permissions (S3).
 *
 * <p>Create and edit are the same dialog because they send the same statement — <b>this role now
 * grants exactly these codes</b>. An add/remove delta form would need the browser to hold a correct
 * picture of the current set, and one stale read would take the wrong permission away from
 * everybody holding the role.
 *
 * <h3>Validation as you type, naming the field and the real problem</h3>
 *
 * <p>Three things can be wrong and each says which: a name under two characters, no permission
 * ticked, and permissions beyond the caller's own authority. The first two disable Save, because no
 * server round-trip can make them right. The third does NOT — see below.
 *
 * <h3>Why "beyond your authority" warns instead of blocking</h3>
 *
 * <p>The browser's picture of the ceiling is the access token, and a token is a snapshot: a role
 * granted to this administrator a minute ago is not in a token minted before it. Disabling Save on
 * a stale snapshot would refuse a write the server would have accepted. The server recomputes the
 * caller's permissions from the database on every write and answers 403 `ROLE_CEILING_EXCEEDED`,
 * and that refusal — the server's own sentence, naming how many codes were beyond the ceiling — is
 * rendered inline here on the form that has to change.
 */
export function RoleBuilderDialog({
  role,
  modules,
  open,
  onOpenChange,
}: {
  /** Present → edit that role. Absent → create a new one. */
  role?: AssignableRole;
  modules: PermissionModule[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const { permissions: held } = useCurrentUser();
  const isEdit = role !== undefined;
  const isPending = createRole.isPending || updateRole.isPending;

  // No reset effect: the page mounts this with a `key` derived from the target, so a change of
  // target REMOUNTS and these initialisers ARE the reset.
  const [name, setName] = useState(role?.name ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [serverError, setServerError] = useState<string | null>(null);

  const totalCodes = useMemo(
    () => modules.reduce((sum, module) => sum + module.permissions.length, 0),
    [modules],
  );
  const heldSet = useMemo(() => new Set(held), [held]);
  const beyondCeiling = useMemo(
    () => selected.filter((code) => !heldSet.has(code)),
    [selected, heldSet],
  );

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? "Name is required — staff pick this role by name, not by code."
      : trimmedName.length < 2
        ? "Name is too short — use at least 2 characters."
        : trimmedName.length > 60
          ? `Name is ${trimmedName.length} characters; the limit is 60.`
          : null;
  const permissionsError =
    selected.length === 0
      ? "Tick at least one permission — a role that grants nothing lets its holders sign in to an empty product."
      : null;

  const blocked = nameError !== null || permissionsError !== null;

  function submit() {
    if (blocked) {
      setNameTouched(true);
      return;
    }
    setServerError(null);
    const payload = { name: trimmedName, permissions: selected };

    if (isEdit && role) {
      updateRole.mutate(
        { roleCode: role.code, payload },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError: (e) => setServerError(e.message || "Could not save the role. Please try again."),
        },
      );
      return;
    }

    createRole.mutate(payload, {
      onSuccess: (saved) => {
        toast.success(`Created ${saved.name}`);
        onOpenChange(false);
      },
      // The ceiling refusal and the duplicate-name refusal both arrive as the server's own
      // sentence. Shown inline rather than as a toast, because the control that has to change is
      // on this form.
      onError: (e) => setServerError(e.message || "Could not create the role. Please try again."),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[min(100vw-1.5rem,44rem)] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${role?.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Whatever is ticked when you save is what this role grants from then on. Everyone holding it picks up the change on their next sign-in."
              : "Give the role a name your staff will recognise, then tick what it may do. You can only grant permissions you hold yourself."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">
              Role name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              placeholder="Head Waiter"
              autoComplete="off"
              aria-invalid={nameTouched && nameError !== null}
              aria-describedby="role-name-help"
            />
            <p
              id="role-name-help"
              role={nameTouched && nameError ? "alert" : undefined}
              className={
                nameTouched && nameError
                  ? "text-small font-medium text-destructive"
                  : "text-small text-muted-foreground"
              }
            >
              {nameTouched && nameError
                ? nameError
                : isEdit
                  ? `Renaming is safe — the role keeps its code ${role?.code}, so nobody loses their assignment.`
                  : "The code is generated from the name, so “Head Waiter” becomes HEAD_WAITER."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label htmlFor="perm-search">
                Permissions <span className="text-destructive">*</span>
              </Label>
              <p className="text-small text-muted-foreground" data-testid="permission-count">
                {selected.length} of {totalCodes} selected
              </p>
            </div>
            <PermissionPicker
              modules={modules}
              selected={selected}
              onChange={setSelected}
              callerPermissions={held}
              idPrefix="build"
            />
            {permissionsError && (
              <p role="alert" className="text-small font-medium text-destructive">
                {permissionsError}
              </p>
            )}
            {beyondCeiling.length > 0 && (
              <p role="alert" className="text-small font-medium text-warning-foreground">
                {beyondCeiling.length}{" "}
                {beyondCeiling.length === 1 ? "permission is" : "permissions are"} beyond your own
                authority ({beyondCeiling.slice(0, 3).join(", ")}
                {beyondCeiling.length > 3 ? "…" : ""}). Saving will be refused — a role can only
                grant what its author can already do.
              </p>
            )}
          </div>

          {serverError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-body text-destructive"
            >
              {serverError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || blocked}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

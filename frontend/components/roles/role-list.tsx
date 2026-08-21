"use client";

import { Lock, Pencil, Trash2, Users } from "lucide-react";

import type { AssignableRole } from "@/lib/models/user.model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The roles a caller may see, one card each.
 *
 * <p>Cards rather than a data table on purpose. The three facts an administrator needs before
 * touching a role — what it is called, how much authority it carries, and how many people it would
 * affect — do not sort or filter usefully at eight to twenty rows, and a card can carry the
 * "built-in" distinction and the holder count without a legend.
 *
 * <p>Every row opens the same read-only view, including built-in ones. That is the point: the
 * product could not previously answer "what does Cashier grant?" for anybody.
 */
export function RoleList({
  roles,
  onInspect,
  onEdit,
  onDelete,
  canManage,
}: {
  roles: AssignableRole[];
  onInspect: (role: AssignableRole) => void;
  onEdit: (role: AssignableRole) => void;
  onDelete: (role: AssignableRole) => void;
  canManage: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="role-list">
      {roles.map((role) => {
        const holders = role.assignedUserCount;
        return (
          <li key={role.code}>
            <div
              className={cn(
                "flex h-full flex-col gap-3 rounded-lg border bg-surface-1 p-4 shadow-depth-1",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onInspect(role)}
                    className="text-left text-h2 font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    {role.name}
                  </button>
                  <p className="mt-0.5 truncate font-mono text-small text-foreground-tertiary">
                    {role.code}
                  </p>
                </div>
                {role.system ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground-tertiary">
                    <Lock aria-hidden="true" className="size-3" />
                    Built-in
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Custom
                  </span>
                )}
              </div>

              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body text-muted-foreground">
                <div className="flex items-baseline gap-1.5">
                  <dt className="sr-only">Permissions granted</dt>
                  <dd>
                    <span className="font-semibold text-foreground">{role.permissions.length}</span>{" "}
                    {role.permissions.length === 1 ? "permission" : "permissions"}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users aria-hidden="true" className="size-3.5" />
                  <dt className="sr-only">People holding this role</dt>
                  <dd>
                    <span className="font-semibold text-foreground">{holders}</span>{" "}
                    {holders === 1 ? "person" : "people"}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onInspect(role)}
                  aria-label={`See what ${role.name} grants`}
                >
                  See permissions
                </Button>
                {canManage && !role.system && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(role)}
                      aria-label={`Edit ${role.name}`}
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onDelete(role)}
                      aria-label={`Delete ${role.name}`}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { Building2, Clock, MapPin, MoreHorizontal } from "lucide-react";

import type { BranchSettings } from "@/lib/models/tenant-settings.model";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The tenant's branches.
 *
 * <h2>Cards on a narrow screen, a row per branch on a wide one — one component, no duplication</h2>
 *
 * <p>The row is a CSS grid whose template changes at `md`. At 390px each branch is a stacked block
 * with its details under its name; from 768px up the same markup lines up into columns under the
 * header. Two separate trees (one `md:hidden`, one `hidden md:block`) would double the row count in
 * the accessibility tree and give a screen-reader user every branch twice.
 *
 * <h2>Deactivate, never delete</h2>
 *
 * <p>A branch id is on every order, till session, journal entry and stock movement ever recorded
 * against it. There is no delete affordance here, and the screen offers none: deactivating takes
 * the branch out of the switcher and off the trading floor while its history keeps naming it, and
 * it is reversible from this same menu.
 */

/** The current user's own branch is marked, because "which one am I on" is the first question. */
export function BranchList({
  branches,
  currentBranchId,
  onEdit,
  onToggleActive,
}: {
  branches: BranchSettings[];
  currentBranchId: string;
  onEdit: (branch: BranchSettings) => void;
  onToggleActive: (branch: BranchSettings) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="hidden gap-3 border-b bg-muted/30 px-3 py-2 text-label font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,1.4fr)_auto]">
        <span>Branch</span>
        <span>Address</span>
        <span>Time zone</span>
        <span className="sr-only">Actions</span>
      </div>

      <ul className="divide-y">
        {branches.map((branch) => (
          <li
            key={branch.id}
            data-testid="branch-row"
            data-branch-active={branch.isActive}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-3 py-3 text-small md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,1.4fr)_auto] md:items-center md:py-2"
          >
            <div className="min-w-0 md:col-start-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate font-medium">{branch.name}</span>
                {/*
                 * HQ is plain text, not a badge. Badges here carry STATE — where you are, and
                 * whether the branch trades — and a third grey chip beside a grey "Deactivated"
                 * makes both harder to read for a fact that never changes.
                 */}
                {branch.isHq ? (
                  <span className="shrink-0 text-label text-muted-foreground">Head office</span>
                ) : null}
                {branch.id === currentBranchId ? (
                  <StatusBadge status="active" label="Your branch" />
                ) : null}
                {!branch.isActive ? <StatusBadge status="inactive" label="Deactivated" /> : null}
              </div>
            </div>

            <p className="col-start-1 flex min-w-0 items-center gap-1.5 text-muted-foreground md:col-start-2">
              <MapPin className="size-3.5 shrink-0 md:hidden" aria-hidden="true" />
              <span className="truncate">{branch.address || "No address set"}</span>
            </p>

            <p className="col-start-1 flex items-center gap-1.5 text-muted-foreground md:col-start-3">
              <Clock className="size-3.5 shrink-0 md:hidden" aria-hidden="true" />
              <span className="truncate">{branch.timezone || "—"}</span>
            </p>

            <div className="col-start-2 row-start-1 justify-self-end md:col-start-4">
              <PermissionGuard require={["rbac.manage", "branch.manage"]} mode="any">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${branch.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(branch)}>
                      Edit details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onToggleActive(branch)}
                      // HQ is the tenant's registered seat and every provisioning path assumes it
                      // exists. Deactivating it would leave a tenant with no head office and no
                      // screen to get one back, so the control is shown and refused rather than
                      // hidden — an administrator looking for it should find out why.
                      disabled={branch.isHq && branch.isActive}
                    >
                      {branch.isActive ? "Deactivate" : "Reactivate"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </PermissionGuard>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

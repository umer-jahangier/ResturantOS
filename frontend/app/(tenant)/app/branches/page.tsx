"use client";

import { useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { BranchList } from "@/components/branches/branch-list";
import { BranchFormDialog } from "@/components/branches/branch-form-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useTenantBranches, useUpdateBranchById } from "@/lib/hooks/use-tenant-settings";
import { formatUserFacingError } from "@/lib/errors";
import type { BranchSettings } from "@/lib/models/tenant-settings.model";

/**
 * URL: /app/branches — the tenant's trading locations.
 *
 * <h2>What was here before</h2>
 *
 * <p>Nothing. `/app/branches`, `/app/settings/branches`, `/app/branch`, `/app/locations` and
 * `/app/admin/branches` all rendered *"This page doesn't exist"*, driven as OWNER and as
 * TENANT_ADMIN on 2026-08-12, and a 35-entry sidebar contained no href matching `branch`. A
 * restaurant group could not add its second site, rename one, or take one out of service from the
 * product at all — while `POST`, `PUT` and `DELETE /api/v1/branches` had existed and been gated
 * since phase 13. Structurally present, behaviourally absent.
 *
 * <h2>Three rules this screen holds</h2>
 *
 * <ul>
 *   <li><b>Error before empty.</b> `QueryBoundary` reads the query's failure; it is never folded
 *       into a length check. "No branches yet" shown because user-service is down would tell an
 *       owner their restaurant group has no locations (GA-001).</li>
 *   <li><b>Deactivate, never delete.</b> A branch id is on every order, till session and journal
 *       entry ever recorded against it. Deactivating takes it out of the branch switcher and off
 *       the trading floor; the history keeps naming it, and the action is reversible.</li>
 *   <li><b>The switcher and this list agree.</b> Creating a branch also puts the creator on it,
 *       and deactivating one removes it from `/api/v1/branches/mine` — both server-side, both
 *       invalidated here, so the switcher never offers somewhere that is closed and never omits
 *       somewhere just opened.</li>
 * </ul>
 */

const EMPTY_TITLE = "No branches yet";
const EMPTY_BODY =
  "A branch is one trading location — its own till, its own kitchen, its own takings. Every restaurant has at least one.";

type FormTarget = { mode: "create" } | { mode: "edit"; branch: BranchSettings };

function BranchesPage() {
  const { branchId } = useCurrentUser();
  const branchesQuery = useTenantBranches();
  const updateBranch = useUpdateBranchById();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [showDeactivated, setShowDeactivated] = useState(false);
  // Deactivating is confirmed rather than immediate: a branch with no orders looks identical to
  // one a shift is running on right now, and taking the second one out removes it from the
  // switcher under the people standing at its till.
  const [deactivateTarget, setDeactivateTarget] = useState<BranchSettings | null>(null);

  const allBranches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const visibleBranches = useMemo(
    () =>
      [...(showDeactivated ? allBranches : allBranches.filter((b) => b.isActive))].sort((a, b) => {
        if (a.isHq !== b.isHq) return a.isHq ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [allBranches, showDeactivated],
  );
  const deactivatedCount = allBranches.filter((b) => !b.isActive).length;

  function handleToggleActive(branch: BranchSettings) {
    if (branch.isActive) {
      setDeactivateTarget(branch);
      return;
    }
    updateBranch.mutate(
      { branchId: branch.id, patch: { isActive: true } },
      {
        onSuccess: () => toast.success(`${branch.name} is trading again.`),
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  function confirmDeactivate() {
    const branch = deactivateTarget;
    if (!branch) return;
    updateBranch.mutate(
      { branchId: branch.id, patch: { isActive: false } },
      {
        onSuccess: () => {
          toast.success(`${branch.name} is no longer trading.`);
          setDeactivateTarget(null);
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  return (
    /*
     * ZONE: expressive — the same assignment Settings carries (D-34-02). This is a back-office
     * configuration surface, richer than the restrained shell it is nested in.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Branches"
        description="Every location this restaurant trades from. Adding one puts you on it, so you can switch to it and set up its menu, staff and till."
        /*
         * The demo's `·`-separated stat subtitle, on figures this screen genuinely holds: both
         * are lengths of an array it has already read. `deactivatedCount` is stated only when it
         * is non-zero — "0 deactivated" is noise, and a reader who has never deactivated a branch
         * does not need to be taught the word.
         */
        meta={
          <>
            {allBranches.length} {allBranches.length === 1 ? "branch" : "branches"}
            {deactivatedCount > 0 ? ` · ${deactivatedCount} deactivated` : ""}
          </>
        }
        actions={
          <PermissionGuard require={["rbac.manage", "branch.manage"]} mode="any">
            <Button
              type="button"
              data-testid="add-branch"
              onClick={() => setFormTarget({ mode: "create" })}
            >
              Add branch
            </Button>
          </PermissionGuard>
        }
      />

      {deactivatedCount > 0 && (
        <label className="flex w-fit items-center gap-2 text-small text-muted-foreground">
          <input
            type="checkbox"
            checked={showDeactivated}
            onChange={(e) => setShowDeactivated(e.target.checked)}
            className="size-4 rounded-sm border-input"
          />
          Show deactivated ({deactivatedCount})
        </label>
      )}

      <QueryBoundary
        query={branchesQuery}
        what="your branches"
        moduleLabel="Branches"
        stillWorks="Everything already open on your current branch keeps working."
        isEmpty={visibleBranches.length === 0}
        loading={
          <div className="grid gap-2" data-testid="branches-loading">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        }
        empty={
          <PermissionGuard
            require={["rbac.manage", "branch.manage"]}
            mode="any"
            fallback={<EmptyState icon={Building2} title={EMPTY_TITLE} description={EMPTY_BODY} />}
          >
            <EmptyState
              icon={Building2}
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{ label: "Add branch", onClick: () => setFormTarget({ mode: "create" }) }}
            />
          </PermissionGuard>
        }
      >
        <BranchList
          branches={visibleBranches}
          currentBranchId={branchId}
          onEdit={(branch) => setFormTarget({ mode: "edit", branch })}
          onToggleActive={handleToggleActive}
        />
      </QueryBoundary>

      <BranchFormDialog
        key={
          formTarget
            ? formTarget.mode === "edit"
              ? `edit-${formTarget.branch.id}`
              : "create"
            : "branch-form-idle"
        }
        branch={formTarget?.mode === "edit" ? formTarget.branch : undefined}
        open={formTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFormTarget(null);
        }}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeactivateTarget(null);
        }}
        title={`Stop trading at ${deactivateTarget?.name ?? "this branch"}?`}
        body="It leaves everyone's branch switcher, so nobody can take an order or start a till there. Nothing is deleted — its orders, takings and ledger stay exactly as they are, and you can bring it back from “Show deactivated”."
        confirmLabel="Deactivate branch"
        pendingLabel="Deactivating…"
        onConfirm={confirmDeactivate}
        isPending={updateBranch.isPending}
      />
    </ZoneProvider>
  );
}

export default function Page() {
  return (
    /*
     * The same gate the endpoints enforce: `hasAnyAuthority('rbac.manage','branch.manage')`.
     * OWNER holds `rbac.manage`; TENANT_ADMIN deliberately does not (13-02) and holds
     * `branch.manage` — requiring both would hide this screen from the role it exists for.
     */
    <PermissionGuard
      require={["rbac.manage", "branch.manage"]}
      mode="any"
      fallback={<AccessDenied />}
    >
      <BranchesPage />
    </PermissionGuard>
  );
}

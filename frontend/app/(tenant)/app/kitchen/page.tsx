"use client";

import { StationPicker } from "@/components/kds/station-picker";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * KDS station picker (KDS-04/D-12). Lists active stations for the branch; a
 * single station auto-navigates to `kitchen/[stationCode]`. Gated by FEATURE_KDS
 * feature flag and pos.kds.view permission (unchanged from the pre-07.3-10 board).
 */
export default function KitchenPage() {
  const { branchId } = useCurrentUser();

  return (
    <FeatureGuard
      feature="FEATURE_KDS"
      fallback={
        <div
          data-surface="kds"
          className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
        >
          Kitchen Display feature is not enabled for this account.
        </div>
      }
    >
      <PermissionGuard
        require="pos.kds.view"
        fallback={
          <div
            data-surface="kds"
            className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
          >
            You do not have permission to access the Kitchen Display.
          </div>
        }
      >
        {!branchId ? (
          <div
            data-surface="kds"
            className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
          >
            No branch selected
          </div>
        ) : (
          <StationPicker branchId={branchId} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

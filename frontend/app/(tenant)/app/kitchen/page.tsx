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
        <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-400">
          Kitchen Display feature is not enabled for this account.
        </div>
      }
    >
      <PermissionGuard
        require="pos.kds.view"
        fallback={
          <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-400">
            You do not have permission to access the Kitchen Display.
          </div>
        }
      >
        {!branchId ? (
          <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-400">
            No branch selected
          </div>
        ) : (
          <StationPicker branchId={branchId} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

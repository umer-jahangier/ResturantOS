"use client";

import { KdsBoard } from "@/components/kds/kds-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Kitchen Display System page.
 * Always-dark board; gated by FEATURE_KDS feature flag and pos.kds.view permission.
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
          <KdsBoard branchId={branchId} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

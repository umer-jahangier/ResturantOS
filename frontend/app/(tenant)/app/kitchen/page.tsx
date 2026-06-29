"use client";

import { KdsBoard } from "@/components/kds/kds-board";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Kitchen Display System page.
 * Always-dark board; gated by FEATURE_KDS feature flag and pos.kds.view permission.
 * The FeatureGuard/PermissionGuard wrapping is handled by the layout/middleware;
 * here we just render the board with the current user's branch.
 */
export default function KitchenPage() {
  const { branchId } = useCurrentUser();

  if (!branchId) {
    return (
      <div className="dark bg-gray-950 min-h-screen flex items-center justify-center text-gray-400">
        No branch selected
      </div>
    );
  }

  return <KdsBoard branchId={branchId} />;
}

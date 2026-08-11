"use client";

import { use } from "react";
import { StationBoard } from "@/components/kds/station-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface StationBoardPageProps {
  params: Promise<{ stationCode: string }>;
}

/**
 * Station-isolated KDS board (KDS-04/D-12). URL: `/app/kitchen/[stationCode]`.
 * Same FEATURE_KDS/pos.kds.view guards as the station picker.
 */
export default function StationBoardPage({ params }: StationBoardPageProps) {
  const { stationCode } = use(params);
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
          <StationBoard branchId={branchId} stationCode={stationCode} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

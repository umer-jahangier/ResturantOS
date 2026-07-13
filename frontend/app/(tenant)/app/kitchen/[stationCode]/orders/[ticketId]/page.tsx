"use client";

import { use } from "react";
import { KdsStationDetail } from "@/components/kds/kds-station-detail";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface KdsTicketDetailPageProps {
  params: Promise<{ stationCode: string; ticketId: string }>;
}

/**
 * Dedicated KDS ticket detail route (KDS-04/D-12) — replaces the pre-07.3-10 tap-
 * to-open Dialog. URL: `/app/kitchen/[stationCode]/orders/[ticketId]`. Same
 * FEATURE_KDS/pos.kds.view guards as the station board.
 */
export default function KdsTicketDetailPage({ params }: KdsTicketDetailPageProps) {
  const { stationCode, ticketId } = use(params);
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
          <KdsStationDetail branchId={branchId} stationCode={stationCode} ticketId={ticketId} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

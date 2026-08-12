"use client";

import { use } from "react";
import { KdsClearedBoard } from "@/components/kds/kds-cleared-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface KdsClearedPageProps {
  params: Promise<{ stationCode: string }>;
}

/**
 * The tickets aged off this board (F17). URL: `/app/kitchen/[stationCode]/cleared`.
 *
 * <p>Gated on {@code pos.kds.view}, not on {@code pos.kds.update}: reading what was cleared is a
 * read of the board, and the person most likely to want it — a manager the morning after — may not
 * be the person who cleared it.
 *
 * <p>ZONE: operational on the screen AND on all three fallbacks, for the reason the board page
 * gives: a permission-denied kitchen screen is still a kitchen screen, and a fallback outside the
 * zone is the one route by which a compositing filter reaches a wall display.
 */
export default function KdsClearedPage({ params }: KdsClearedPageProps) {
  const { stationCode } = use(params);
  const { branchId } = useCurrentUser();

  return (
    <FeatureGuard
      feature="FEATURE_KDS"
      fallback={
        <ZoneProvider zone="operational" asChild>
          <div
            data-surface="kds"
            data-zone="operational"
            className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
          >
            Kitchen Display feature is not enabled for this account.
          </div>
        </ZoneProvider>
      }
    >
      <PermissionGuard
        require="pos.kds.view"
        fallback={
          <ZoneProvider zone="operational" asChild>
            <div
              data-surface="kds"
              data-zone="operational"
              className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
            >
              You do not have permission to access the Kitchen Display.
            </div>
          </ZoneProvider>
        }
      >
        {!branchId ? (
          <ZoneProvider zone="operational" asChild>
            <div
              data-surface="kds"
              data-zone="operational"
              className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
            >
              No branch selected
            </div>
          </ZoneProvider>
        ) : (
          <KdsClearedBoard branchId={branchId} stationCode={stationCode} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

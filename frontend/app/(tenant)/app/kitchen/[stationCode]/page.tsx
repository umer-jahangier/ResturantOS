"use client";

import { use } from "react";
import { StationBoard } from "@/components/kds/station-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { PageBody } from "@/components/ui/page-body";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface StationBoardPageProps {
  params: Promise<{ stationCode: string }>;
}

/**
 * Station-isolated KDS board (KDS-04/D-12). URL: `/app/kitchen/[stationCode]`.
 * Same FEATURE_KDS/pos.kds.view guards as the station picker.
 *
 * ZONE: operational (D-34-02) — on the board AND on all three fallbacks. A
 * permission-denied kitchen screen is still a kitchen screen: it renders on the same
 * wall-mounted display, and if it falls outside the zone it becomes the one route by
 * which a compositing filter or a decorative animation reaches that display. The
 * fallbacks each render their own root, so each declares the zone itself rather than
 * inheriting one from a shared ancestor that does not exist.
 *
 * FULL-BLEED (38-05 task 2, UI-SPEC §9.3), for the same reason and on the same four arms. The
 * board's own 48px station header is the only header on this route — no `PageHeader`, which is
 * §9.3's "station header only" and also the honest answer to a token gap: `PageHeader` is built
 * on `text-foreground` / `text-foreground-secondary`, and `[data-surface="kds"]` redefines only
 * the `--kds-*` family, so on a light-theme browser those resolve to near-black ON near-black.
 * That is the same defect this board's own empty states carry a comment about; it is not worth
 * re-shipping for the sake of a component name.
 */
export default function StationBoardPage({ params }: StationBoardPageProps) {
  const { stationCode } = use(params);
  const { branchId } = useCurrentUser();

  return (
    <PageBody fullBleed>
      <FeatureGuard
        feature="FEATURE_KDS"
        fallback={
          <ZoneProvider zone="operational" asChild>
            <div
              data-surface="kds"
              data-zone="operational"
              className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
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
                className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
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
                className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
              >
                No branch selected
              </div>
            </ZoneProvider>
          ) : (
            <StationBoard branchId={branchId} stationCode={stationCode} />
          )}
        </PermissionGuard>
      </FeatureGuard>
    </PageBody>
  );
}

"use client";

import { use } from "react";
import { KdsClearedBoard } from "@/components/kds/kds-cleared-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PageBody } from "@/components/ui/page-body";
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
 *
 * FULL-BLEED (38-05 task 2, UI-SPEC §9.3). Every route under `/app/kitchen/**` renders inside
 * `<PageBody fullBleed>`, which is what suppresses the shell's back-office gutter
 * (`main:has([data-page-body]) { padding: 0 }`). Named in 38-05's Files list or not, a kitchen
 * screen that keeps the gutter is a dark board in a light frame — the exact thing the audit
 * photographed — and a cook moving between the board, the pass and a ticket would watch the
 * frame appear and disappear. `min-h-screen` goes with it: `<main>` is already the viewport less
 * the top bar, so a 100vh minimum inside it is taller than its own container and grows a second
 * scrollbar.
 */
export default function KdsClearedPage({ params }: KdsClearedPageProps) {
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
            <KdsClearedBoard branchId={branchId} stationCode={stationCode} />
          )}
        </PermissionGuard>
      </FeatureGuard>
    </PageBody>
  );
}

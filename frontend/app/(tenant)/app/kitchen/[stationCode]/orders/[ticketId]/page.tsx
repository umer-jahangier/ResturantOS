"use client";

import { use } from "react";
import { KdsStationDetail } from "@/components/kds/kds-station-detail";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PageBody } from "@/components/ui/page-body";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

interface KdsTicketDetailPageProps {
  params: Promise<{ stationCode: string; ticketId: string }>;
}

/**
 * Dedicated KDS ticket detail route (KDS-04/D-12) — replaces the pre-07.3-10 tap-
 * to-open Dialog. URL: `/app/kitchen/[stationCode]/orders/[ticketId]`. Same
 * FEATURE_KDS/pos.kds.view guards as the station board.
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
export default function KdsTicketDetailPage({ params }: KdsTicketDetailPageProps) {
  const { stationCode, ticketId } = use(params);
  const { branchId } = useCurrentUser();

  return (
    <PageBody fullBleed>
      <FeatureGuard
        feature="FEATURE_KDS"
        fallback={
          <div
            data-surface="kds"
            className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
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
              className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
            >
              You do not have permission to access the Kitchen Display.
            </div>
          }
        >
          {!branchId ? (
            <div
              data-surface="kds"
              className="flex h-full min-h-full items-center justify-center bg-kds-surface text-kds-muted"
            >
              No branch selected
            </div>
          ) : (
            <KdsStationDetail branchId={branchId} stationCode={stationCode} ticketId={ticketId} />
          )}
        </PermissionGuard>
      </FeatureGuard>
    </PageBody>
  );
}

"use client";

import { Radio, RefreshCw } from "lucide-react";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { DashboardTileGrid } from "@/components/reporting/DashboardTileGrid";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDashboardTiles } from "@/lib/hooks/reporting/use-reports";
import { useDashboardSocket } from "@/lib/hooks/reporting/use-dashboard-socket";
import { cn } from "@/lib/utils";

/**
 * Whether the board is live, said three ways.
 *
 * <p>This line was `bg-emerald-500` / `bg-amber-500` — two raw palette literals (gate G3) that
 * follow neither theme nor `--brand-h`, on the one control in the product whose whole job is to
 * tell a manager whether the numbers in front of them are current. They are `--success` and
 * `--warning` now, which is what they meant.
 *
 * <p>Hue never travels alone (D-38-13): the state is carried by the WORD ("Live" /
 * "Reconnecting…"), by the ICON SHAPE (a broadcast mark vs a retry arrow) and only then by the
 * colour. Drop the colour entirely and the line still reads correctly, which is the test.
 */
function ConnectionIndicator({ isConnected }: { isConnected: boolean }) {
  const Icon = isConnected ? Radio : RefreshCw;
  return (
    <p
      data-testid="realtime-connection"
      className={cn(
        "inline-flex items-center gap-(--space-xs) text-small font-medium",
        isConnected ? "text-success" : "text-warning",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {isConnected ? "Live" : "Reconnecting…"}
    </p>
  );
}

function RealtimeDashboard() {
  const { branchId } = useCurrentUser();
  // The REST snapshot (12-06) paints instantly on mount — a realtime dashboard that is blank
  // until the next order closes looks broken.
  const { data: snapshotTiles, isLoading } = useDashboardTiles(branchId);
  // The WebSocket then keeps it live, merging into the SAME query-cache key as the snapshot.
  const { isConnected, tiles: liveTiles } = useDashboardSocket({ branchId });

  const tiles = liveTiles ?? snapshotTiles;

  return (
    <>
      <PageHeader
        title="Realtime Dashboard"
        description="Updates automatically when an order or till closes."
        actions={<ConnectionIndicator isConnected={isConnected} />}
      />
      <DashboardTileGrid tiles={tiles} isLoading={isLoading} />
    </>
  );
}

/**
 * `/app/dashboard/realtime` — RPT-02.
 *
 * <p>One of the three surfaces N12 named as having drifted into a second visual language: no
 * `PageHeader`, no `StatTile`, a hand-rolled `h1` at `text-xl`, tile values at `text-3xl` and
 * two raw palette literals — all of it a corridor away from `/app/dashboard`, which is built
 * from the contract's primitives. No phase-38 plan owned this route, which is exactly why it
 * drifted, and it is on the shared grammar now.
 */
export default function RealtimeDashboardPage() {
  return (
    <PermissionGuard require="reporting.dashboard.view" fallback={<AccessDenied />}>
      <PageBody className="space-y-(--space-lg)">
        <RealtimeDashboard />
      </PageBody>
    </PermissionGuard>
  );
}

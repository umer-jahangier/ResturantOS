"use client";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { DashboardTileGrid } from "@/components/reporting/DashboardTileGrid";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDashboardTiles } from "@/lib/hooks/reporting/use-reports";
import { useDashboardSocket } from "@/lib/hooks/reporting/use-dashboard-socket";

function ConnectionIndicator({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`inline-block size-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <span className="text-muted-foreground">{isConnected ? "Live" : "Reconnecting…"}</span>
    </div>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Realtime Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Updates automatically when an order or till closes.
          </p>
        </div>
        <ConnectionIndicator isConnected={isConnected} />
      </div>

      <DashboardTileGrid tiles={tiles} isLoading={isLoading} />
    </div>
  );
}

export default function RealtimeDashboardPage() {
  return (
    <PermissionGuard require="reporting.dashboard.view" fallback={<AccessDenied />}>
      <div className="p-6">
        <RealtimeDashboard />
      </div>
    </PermissionGuard>
  );
}

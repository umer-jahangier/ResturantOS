"use client";

import { ExpoBoard } from "@/components/kds/expo-board";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * The expo / pass view — `/app/kitchen/expo`.
 *
 * <h3>Why this path, and why it is safe next to `[stationCode]`</h3>
 *
 * A static segment always beats a dynamic sibling in the Next.js App Router, so this page
 * wins over `/app/kitchen/[stationCode]` for the literal lowercase path `expo`. That does
 * reserve one station code, and it is the RIGHT one to reserve: `EXPO` is already a station
 * TYPE in the product ("Expo (the pass)" in the station dialog, `StationType.EXPO` in both
 * services), described in kitchen-service as the family that "sees everything". A station
 * whose code is literally `EXPO` — uppercase — still resolves to `[stationCode]` and gets its
 * own isolated board, because static-segment matching is case-sensitive.
 *
 * <h3>Guards</h3>
 *
 * The same two the station boards carry, and no more: `FEATURE_KDS` and `pos.kds.view`. The
 * pass reads exactly the branch-wide ticket list `/app/kitchen` already reads to draw its
 * station tiles, so it needs no permission that screen does not — and widening one to make a
 * screen work is forbidden. Bumping a line FROM the pass is gated separately, inside the
 * board, on `pos.kds.update` — the same code the station boards gate their bump on.
 *
 * ZONE: operational (D-34-02), on the board AND on every fallback — a permission-denied
 * kitchen screen is still a kitchen screen, and it renders on the same wall-mounted display.
 */
export default function ExpoPage() {
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
          <ExpoBoard branchId={branchId} />
        )}
      </PermissionGuard>
    </FeatureGuard>
  );
}

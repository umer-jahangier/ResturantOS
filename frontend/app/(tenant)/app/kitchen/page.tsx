"use client";

import { StationPicker } from "@/components/kds/station-picker";
import { PageBody } from "@/components/ui/page-body";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * KDS station picker (KDS-04/D-12). Lists active stations for the branch; a
 * single station auto-navigates to `kitchen/[stationCode]`. Gated by FEATURE_KDS
 * feature flag and pos.kds.view permission (unchanged from the pre-07.3-10 board).
 *
 * FULL-BLEED (38-05 task 2, UI-SPEC §9.3). `<PageBody fullBleed>` is what removes the shell's
 * back-office gutter — `main:has([data-page-body]) { padding: 0 }` — so the dark board reaches
 * the edge of `<main>` instead of floating inside 24px of light chrome, which is what the audit
 * photographed. It wraps EVERY arm, the two guard fallbacks included: a kitchen screen that says
 * "not enabled" is still on the same wall-mounted display, and if it renders with the gutter it
 * is a light frame around a dark box for exactly the reason the board was.
 *
 * It does NOT remove the sidebar or the top bar, and is not meant to. UI-SPEC §5 zones the shell
 * as `restrained` chrome that composites OVER the KDS; §9.3 asks for "full-bleed via `PageBody`,
 * station header only", which is this. Removing the shell from the kitchen routes is a routing
 * change, not a layout one.
 */
export default function KitchenPage() {
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
            <StationPicker branchId={branchId} />
          )}
        </PermissionGuard>
      </FeatureGuard>
    </PageBody>
  );
}

"use client";

import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { TillReview } from "@/components/pos/till-review";

/**
 * Admin till-review page — a reviewable table of the branch's till sessions (opening/closing,
 * cashier, variance) each expanding into its orders + cash collected.
 * URL: /app/pos/tills
 */
export default function TillsPage() {
  return (
    <FeatureGuard
      feature="FEATURE_POS"
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          POS feature is not enabled for this account.
        </div>
      }
    >
      <PermissionGuard
        require="pos.order.view.all"
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            You do not have permission to review tills.
          </div>
        }
      >
        <TillReview />
      </PermissionGuard>
    </FeatureGuard>
  );
}

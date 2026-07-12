"use client";

import { use } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ChargeSummary } from "@/components/pos/charge-summary";

interface ChargePageProps {
  params: Promise<{ orderId: string }>;
}

/**
 * Dedicated full-page Charge surface (POS-22/23/25, 07.3-UI-SPEC §2) — replaces the
 * cramped narrow-width `PaymentPanel` modal. `SettlementActions`' CHARGE NOW button
 * navigates here (07.3-07 Task 3) instead of opening the modal. Guards mirror
 * `app/(tenant)/app/pos/page.tsx`'s FEATURE_POS + closest settlement permission
 * (`pos.order.close` — recording a payment on this page is the settlement action).
 *
 * URL: /app/pos/orders/[orderId]/charge
 */
export default function ChargePage({ params }: ChargePageProps) {
  const { orderId } = use(params);

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
        require="pos.order.close"
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            You do not have permission to charge orders.
          </div>
        }
      >
        <ChargeSummary orderId={orderId} />
      </PermissionGuard>
    </FeatureGuard>
  );
}

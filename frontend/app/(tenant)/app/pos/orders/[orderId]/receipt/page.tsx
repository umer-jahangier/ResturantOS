"use client";

import { use } from "react";

import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ReceiptView } from "@/components/print/receipt-view";

interface ReceiptPageProps {
  params: Promise<{ orderId: string }>;
}

/**
 * The printable customer bill (Phase 26, plan 26-05 — D-26-01's plain tier).
 *
 * <p>Guards mirror the sibling Charge route: `FEATURE_POS`, then the closest permission. Here that
 * is `pos.order.view` rather than `pos.order.close`, matching the endpoints 26-03 exposes —
 * <b>reprinting is reading</b>, and a cashier who may see an order may hand its bill to the
 * customer standing in front of them without fetching a manager.
 *
 * <p>URL: `/app/pos/orders/[orderId]/receipt`
 */
export default function ReceiptPage({ params }: ReceiptPageProps) {
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
        require="pos.order.view"
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            You do not have permission to view this bill.
          </div>
        }
      >
        <ReceiptView orderId={orderId} />
      </PermissionGuard>
    </FeatureGuard>
  );
}

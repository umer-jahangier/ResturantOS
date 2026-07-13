"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { VoidRefundDialog } from "@/components/pos/void-refund-dialog";
import type { Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface SettlementActionsProps {
  order: Order;
  className?: string;
}

const SETTLED_STATUSES: ReadonlySet<Order["status"]> = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * Shared settlement surface (UI-SPEC §7/§2, POS-14/POS-22/POS-25): CHARGE NOW navigates
 * to the dedicated full-page Charge route (`/app/pos/orders/{id}/charge`, 07.3-07) —
 * NOT a modal — plus `VoidRefundDialog`'s icon-button group. Rendered identically in
 * every caller (OrderPanel footer, Order/Table Detail drawer footer) — never
 * re-implement a second payment UI, always compose this component.
 *
 * Permission composition: CHARGE NOW is individually `PermissionGuard`-wrapped
 * (`pos.order.close`); `VoidRefundDialog` keeps its own internal per-action
 * `PermissionGuard`s unchanged (it already composes correctly) rather than wrapping the
 * whole cluster in one all-or-nothing guard, which would incorrectly hide Void from a
 * user who holds void but not close permission.
 */
export function SettlementActions({ order, className }: SettlementActionsProps) {
  const router = useRouter();

  const isSettled = SETTLED_STATUSES.has(order.status);
  const canCharge = !isSettled && order.totalPaisa > 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        {order.status === "CLOSED" ? (
          <span
            data-testid="paid-chip"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success/15 px-3 py-3 text-sm font-semibold text-success"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Paid ✓
          </span>
        ) : (
          !isSettled && (
            <PermissionGuard require="pos.order.close">
              <button
                type="button"
                data-testid="charge-now-button"
                onClick={() => router.push(`/app/pos/orders/${order.id}/charge`)}
                disabled={!canCharge}
                aria-label="Charge order"
                className="h-12 flex-1 rounded-xl border font-semibold text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 enabled:border-primary enabled:text-primary enabled:hover:bg-primary/5 enabled:active:scale-[0.98]"
              >
                CHARGE NOW
              </button>
            </PermissionGuard>
          )
        )}

        <VoidRefundDialog order={order} />
      </div>
    </div>
  );
}

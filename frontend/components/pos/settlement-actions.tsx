"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PaymentPanel } from "@/components/pos/payment-panel";
import { VoidRefundDialog } from "@/components/pos/void-refund-dialog";
import type { Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface SettlementActionsProps {
  order: Order;
  className?: string;
}

const SETTLED_STATUSES: ReadonlySet<Order["status"]> = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/**
 * Shared settlement surface (UI-SPEC §7, POS-14): CHARGE NOW → `PaymentPanel` in a
 * shadcn Dialog, plus `VoidRefundDialog`'s icon-button group. Rendered identically in
 * exactly three places per UI-SPEC: OrderPanel footer (this plan), Order Detail drawer
 * footer (plan 09), Table Detail drawer footer (plan 10) — never re-implement a second
 * payment UI, always compose this component.
 *
 * Permission composition: CHARGE NOW is individually `PermissionGuard`-wrapped
 * (`pos.order.close`); `VoidRefundDialog` keeps its own internal per-action
 * `PermissionGuard`s unchanged (it already composes correctly) rather than wrapping the
 * whole cluster in one all-or-nothing guard, which would incorrectly hide Void from a
 * user who holds void but not close permission.
 */
export function SettlementActions({ order, className }: SettlementActionsProps) {
  const [chargeOpen, setChargeOpen] = useState(false);

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
                onClick={() => setChargeOpen(true)}
                disabled={!canCharge}
                aria-label="Open charge dialog"
                className="h-12 flex-1 rounded-xl border font-semibold text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 enabled:border-primary enabled:text-primary enabled:hover:bg-primary/5 enabled:active:scale-[0.98]"
              >
                CHARGE NOW
              </button>
            </PermissionGuard>
          )
        )}

        <VoidRefundDialog order={order} onDone={() => setChargeOpen(false)} />
      </div>

      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Payment</DialogTitle>
          </DialogHeader>
          <PaymentPanel order={order} onClose={() => setChargeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

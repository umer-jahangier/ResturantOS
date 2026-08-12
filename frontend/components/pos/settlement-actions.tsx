"use client";

import { CheckCircle2, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { VoidRefundDialog } from "@/components/pos/void-refund-dialog";
import { useReprintKitchenTickets } from "@/lib/hooks/pos/use-print-document";
import { formatUserFacingError } from "@/lib/errors";
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
/**
 * An order that has never been fired has no kitchen ticket to reprint. DRAFT is the only status
 * that means that; everything else — sent, partially served, served, closed — has been to the
 * kitchen at least once, and a cook can lose a ticket at any of them.
 */
const NEVER_FIRED_STATUSES: ReadonlySet<Order["status"]> = new Set(["DRAFT"]);

export function SettlementActions({ order, className }: SettlementActionsProps) {
  const router = useRouter();
  const reprintKot = useReprintKitchenTickets();

  const isSettled = SETTLED_STATUSES.has(order.status);
  const canCharge = !isSettled && order.totalPaisa > 0;
  const wasFired = !NEVER_FIRED_STATUSES.has(order.status);

  async function handleReprintKot() {
    try {
      const reprinted = await reprintKot.mutateAsync(order.id);
      if (reprinted.length === 0) {
        // A real answer, said out loud. Reporting "reprinted" here would be the product claiming
        // paper that is not coming — which is the failure mode this whole repair exists to end.
        toast.warning(
          "Nothing to reprint: this order has no kitchen ticket. Either it was never fired, or " +
            "no station had a printer configured when it was — check Settings → Printers.",
        );
        return;
      }
      const stations = reprinted.map((r) => r.targetPrinterId).join(", ");
      toast.success(
        reprinted.length === 1
          ? `Kitchen ticket queued for ${stations}.`
          : `Kitchen tickets queued for ${stations}.`,
      );
    } catch (error) {
      toast.error(`Could not reprint the kitchen ticket — ${formatUserFacingError(error)}`);
    }
  }

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
                /*
                 * F14 — no `aria-label` here, deliberately.
                 *
                 * It used to carry `aria-label="Charge order"` while the glass read CHARGE NOW.
                 * `aria-label` does not ADD to a button's accessible name, it REPLACES the
                 * button's text, so Chromium computed the name "Charge order" and marked the
                 * contents superseded (measured over CDP, not inferred). Three things followed:
                 * a screen reader announced words that are nowhere on screen, a speech-input
                 * operator saying "click charge now" hit nothing, and every test looking for the
                 * printed words found nothing — which is why the whole suite reached for
                 * `data-testid` instead, and why nobody noticed for as long as it existed.
                 *
                 * With no attribute in the way the name is computed from the contents, so the
                 * announced name IS the printed label and the two cannot drift apart. Extra
                 * context belongs in an `sr-only` span INSIDE the button (which appends to the
                 * name), never in an attribute that overrides it. `settlement-actions-label-in-
                 * name.test.tsx` fails if this comes back — for this button or any future one.
                 */
                className="h-12 flex-1 rounded-xl border font-semibold text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 enabled:border-primary enabled:text-primary enabled:hover:bg-primary/5 enabled:active:scale-[0.98]"
              >
                CHARGE NOW
              </button>
            </PermissionGuard>
          )
        )}

        <VoidRefundDialog order={order} />
      </div>

      {/*
        Reprint kitchen ticket (S1-06). Sited in the SHARED settlement surface rather than on one
        screen, because the person who needs it is whoever is nearest when the cook says the ticket
        is gone — and this component is rendered in both the order panel footer and the order/table
        drawer.

        Gated on `pos.order.send_to_kds`, the same permission the endpoint carries, because paper on
        the pass is an instruction to cook. A control that 403s is worse than no control.
      */}
      {wasFired && (
        <PermissionGuard require="pos.order.send_to_kds">
          <button
            type="button"
            data-testid="reprint-kot-button"
            onClick={() => void handleReprintKot()}
            disabled={reprintKot.isPending}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ReceiptText className="size-4" aria-hidden="true" />
            {reprintKot.isPending ? "Sending…" : "Reprint kitchen ticket"}
          </button>
        </PermissionGuard>
      )}
    </div>
  );
}

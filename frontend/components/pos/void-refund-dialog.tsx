"use client";

import { useState } from "react";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useVoidOrder, useRefundOrder } from "@/lib/hooks/pos/use-payments";
import type { Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface VoidRefundDialogProps {
  order: Order;
  onDone?: () => void;
}

type DialogMode = "void" | "refund";

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function orderTypeLabel(type: Order["type"]): string {
  if (type === "TAKEAWAY") return "Takeaway";
  if (type === "PICKUP") return "Pickup";
  if (type === "DELIVERY") return "Delivery";
  return "Dine-in";
}

/**
 * Void/refund — dedicated large in-place panel (POS-25/D-10, UI-SPEC §5), mirroring the
 * 07.3-07 charge-page panel pattern (plain document-flow section, NOT a Radix Dialog /
 * `[role=dialog]` popup and not the old hand-rolled full-viewport-overlay centered box).
 * Replaces the trigger button row in place when open, carrying the full order/refund
 * analytic info (order summary, reason, refund scope/amount, resulting state). Preserves
 * every existing selector/copy the E2E suite (pos-settlement.spec.ts S6) depends on:
 * the "Void order"/"Refund order" trigger aria-labels, the reason placeholder, "Confirm
 * Void", "Cancel", and the inline error copy.
 */
export function VoidRefundDialog({ order, onDone }: VoidRefundDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>("void");

  // Void form state
  const [voidReason, setVoidReason] = useState("");

  // Refund form state
  const [refundScope, setRefundScope] = useState<"FULL" | "PARTIAL">("FULL");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const voidMutation = useVoidOrder(order.id);
  const refundMutation = useRefundOrder(order.id);

  const canVoidOwn = order.status === "OPEN" || order.status === "SENT_TO_KDS";
  const canRefund = order.status === "CLOSED";

  const closePanel = () => {
    setOpen(false);
    setVoidReason("");
    setRefundAmount("");
    setRefundReason("");
    setRefundScope("FULL");
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) return;
    const idempotencyKey = generateKey();
    await voidMutation.mutateAsync({ payload: { reason: voidReason }, idempotencyKey });
    closePanel();
    onDone?.();
  };

  const handleRefund = async () => {
    if (!refundReason.trim()) return;
    const refundPaisa =
      refundScope === "FULL"
        ? order.totalPaisa
        : Math.round(parseFloat(refundAmount || "0") * 100);
    if (refundPaisa <= 0) return;
    const idempotencyKey = generateKey();
    await refundMutation.mutateAsync({
      payload: { refundPaisa, reason: refundReason, scope: refundScope },
      idempotencyKey,
    });
    closePanel();
    onDone?.();
  };

  const hasAnyPermission = canVoidOwn || canRefund;

  if (!hasAnyPermission) return null;

  if (open) {
    return (
      <div
        data-testid="void-refund-panel"
        className="flex w-full flex-col gap-4 rounded-xl border bg-background p-4 sm:p-6"
      >
        {/* Order summary — full analytic info regardless of mode */}
        <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
          <div className="flex flex-col gap-0.5">
            <h2
              className={cn("font-heading text-base font-semibold", mode === "void" && "text-destructive")}
            >
              {mode === "void" ? "Void Order" : "Refund Order"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Order #{order.orderNo ?? order.id.slice(0, 8)} · {orderTypeLabel(order.type)}
            </p>
          </div>
          <div className="text-right text-sm">
            <span className="text-xs text-muted-foreground">Order total</span>
            <MoneyDisplay paisa={order.totalPaisa} className="block font-medium" />
          </div>
        </div>

        {mode === "void" ? (
          <>
            <p className="text-sm text-muted-foreground">
              This will cancel order <strong>#{order.orderNo ?? order.id.slice(0, 8)}</strong>.
              This action cannot be undone.
            </p>
            <label className="text-sm">
              Reason <span className="text-destructive">*</span>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded border px-3 py-2 text-sm resize-none"
                placeholder="e.g. Customer left without ordering"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Resulting state: order will be marked <strong>VOIDED</strong> and removed from active
              settlement.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={closePanel} className="text-sm px-4 py-2 rounded border">
                Cancel
              </button>
              <button
                onClick={() => void handleVoid()}
                disabled={!voidReason.trim() || voidMutation.isPending}
                className="text-sm px-4 py-2 rounded bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 disabled:opacity-50"
              >
                {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
              </button>
            </div>
            {voidMutation.isError && (
              <p className="text-xs text-destructive">
                {voidMutation.error?.status === 403
                  ? "You don't have permission to void this order."
                  : "Failed to void. Please try again."}
              </p>
            )}
          </>
        ) : (
          <>
            {/* Scope selector */}
            <div className="flex gap-3">
              {(["FULL", "PARTIAL"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="refund-scope"
                    value={s}
                    checked={refundScope === s}
                    onChange={() => setRefundScope(s)}
                  />
                  {s === "FULL" ? "Full refund" : "Partial refund"}
                </label>
              ))}
            </div>

            {refundScope === "PARTIAL" && (
              <label className="text-sm">
                Amount (PKR) <span className="text-destructive">*</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  placeholder="e.g. 250.00"
                />
              </label>
            )}

            <label className="text-sm">
              Reason <span className="text-destructive">*</span>
              <textarea
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded border px-3 py-2 text-sm resize-none"
                placeholder="e.g. Wrong item served"
              />
            </label>

            <p className="text-xs text-muted-foreground">
              Resulting state: order will be marked{" "}
              <strong>{refundScope === "FULL" ? "REFUNDED" : "PARTIALLY REFUNDED"}</strong>
              {refundScope === "PARTIAL" ? " (remaining balance retained)" : ""}.
            </p>

            <div className="flex gap-2 justify-end">
              <button onClick={closePanel} className="text-sm px-4 py-2 rounded border">
                Cancel
              </button>
              <button
                onClick={() => void handleRefund()}
                disabled={!refundReason.trim() || refundMutation.isPending}
                className={cn(
                  "text-sm px-4 py-2 rounded font-medium disabled:opacity-50",
                  "bg-warning text-warning-foreground hover:bg-warning/90"
                )}
              >
                {refundMutation.isPending ? "Processing…" : "Confirm Refund"}
              </button>
            </div>
            {refundMutation.isError && (
              <p className="text-xs text-destructive">Failed to refund. Please try again.</p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <PermissionGuard require={["pos.order.void.own", "pos.order.void.any"]} mode="any">
        {canVoidOwn && (
          <button
            onClick={() => { setMode("void"); setOpen(true); }}
            aria-label="Void order"
            className="text-xs px-3 py-1 rounded border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
          >
            Void
          </button>
        )}
      </PermissionGuard>

      <PermissionGuard require="pos.order.refund">
        {canRefund && (
          <button
            onClick={() => { setMode("refund"); setOpen(true); }}
            aria-label="Refund order"
            className="text-xs px-3 py-1 rounded border border-warning text-warning hover:bg-warning/10 transition"
          >
            Refund
          </button>
        )}
      </PermissionGuard>
    </div>
  );
}

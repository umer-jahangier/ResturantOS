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

  const handleVoid = async () => {
    if (!voidReason.trim()) return;
    const idempotencyKey = generateKey();
    await voidMutation.mutateAsync({ payload: { reason: voidReason }, idempotencyKey });
    setOpen(false);
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
    setOpen(false);
    onDone?.();
  };

  const hasAnyPermission = canVoidOwn || canRefund;

  if (!hasAnyPermission) return null;

  return (
    <>
      <div className="flex gap-2">
        <PermissionGuard require={["pos.order.void.own", "pos.order.void.any"]} mode="any">
          {canVoidOwn && (
            <button
              onClick={() => { setMode("void"); setOpen(true); }}
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
              className="text-xs px-3 py-1 rounded border border-amber-600 text-amber-700 hover:bg-amber-50 transition"
            >
              Refund
            </button>
          )}
        </PermissionGuard>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl p-6 w-96 flex flex-col gap-4">
            {mode === "void" ? (
              <>
                <h2 className="font-semibold text-destructive">Void Order</h2>
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
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setOpen(false)}
                    className="text-sm px-4 py-2 rounded border"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleVoid}
                    disabled={!voidReason.trim() || voidMutation.isPending}
                    className="text-sm px-4 py-2 rounded bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
                  </button>
                </div>
                {voidMutation.isError && (
                  <p className="text-xs text-destructive">Failed to void. Please try again.</p>
                )}
              </>
            ) : (
              <>
                <h2 className="font-semibold">Refund Order</h2>
                <div className="text-sm flex justify-between">
                  <span className="text-muted-foreground">Order total:</span>
                  <MoneyDisplay paisa={order.totalPaisa} className="font-medium" />
                </div>

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

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setOpen(false)}
                    className="text-sm px-4 py-2 rounded border"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRefund}
                    disabled={!refundReason.trim() || refundMutation.isPending}
                    className={cn(
                      "text-sm px-4 py-2 rounded font-medium disabled:opacity-50",
                      "bg-amber-600 text-white hover:bg-amber-700"
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
        </div>
      )}
    </>
  );
}

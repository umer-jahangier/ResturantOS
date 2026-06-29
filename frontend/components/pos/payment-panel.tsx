"use client";

import { useState } from "react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { useCloseOrder } from "@/lib/hooks/pos/use-payments";
import type { Order, PaymentEntry, PaymentMethod } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface PaymentPanelProps {
  order: Order;
  onClose?: () => void;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "LOYALTY_POINTS",
  "BANK_TRANSFER",
  "VOUCHER",
];

interface PaymentRow {
  id: string;
  method: PaymentMethod;
  amountPaisa: number;
  referenceNo: string;
}

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function PaymentPanel({ order, onClose }: PaymentPanelProps) {
  const [rows, setRows] = useState<PaymentRow[]>([
    { id: generateKey(), method: "CASH", amountPaisa: order.totalPaisa, referenceNo: "" },
  ]);
  const [closed, setClosed] = useState(false);

  const closeOrderMutation = useCloseOrder(order.id);

  const sumPaisa = rows.reduce((acc, r) => acc + r.amountPaisa, 0);
  const remainingPaisa = order.totalPaisa - sumPaisa;
  const isBalanced = remainingPaisa === 0;

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: generateKey(), method: "CASH", amountPaisa: 0, referenceNo: "" },
    ]);

  const updateRow = (id: string, patch: Partial<Omit<PaymentRow, "id">>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const handleCharge = async () => {
    if (!isBalanced) return;
    const idempotencyKey = generateKey();
    const payments: PaymentEntry[] = rows.map((r) => ({
      method: r.method,
      amountPaisa: r.amountPaisa,
      referenceNo: r.referenceNo || null,
    }));
    try {
      await closeOrderMutation.mutateAsync({ payload: { payments }, idempotencyKey });
      setClosed(true);
      onClose?.();
    } catch {
      // Error handled by parent or toast
    }
  };

  if (closed) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">✓</div>
        <p className="text-lg font-semibold text-emerald-600">Order Closed</p>
        <p className="text-sm text-muted-foreground">Order #{order.orderNo} has been charged.</p>
      </div>
    );
  }

  return (
    <PermissionGuard require="pos.order.close" fallback={
      <p className="p-4 text-sm text-destructive">You don&apos;t have permission to close orders.</p>
    }>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Order Total</span>
          <MoneyDisplay paisa={order.totalPaisa} className="text-base font-bold" />
        </div>

        {/* Payment rows */}
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex gap-2 items-center">
              <select
                value={row.method}
                onChange={(e) => updateRow(row.id, { method: e.target.value as PaymentMethod })}
                className="flex-none w-36 rounded border bg-background px-2 py-1.5 text-sm"
                aria-label="Payment method"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ")}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                value={row.amountPaisa === 0 ? "" : String(row.amountPaisa)}
                onChange={(e) =>
                  updateRow(row.id, { amountPaisa: parseInt(e.target.value || "0", 10) || 0 })
                }
                placeholder="Amount (paisa)"
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                aria-label="Amount in paisa"
              />
              <input
                type="text"
                value={row.referenceNo}
                onChange={(e) => updateRow(row.id, { referenceNo: e.target.value })}
                placeholder="Ref# (optional)"
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                aria-label="Reference number"
              />
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(row.id)}
                  className="text-muted-foreground hover:text-destructive text-lg px-1"
                  aria-label="Remove row"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add row button */}
        <button
          onClick={addRow}
          className="text-sm text-primary underline self-start"
        >
          + Add payment method
        </button>

        {/* Remaining balance */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-medium">Remaining</span>
          <MoneyDisplay
            paisa={Math.abs(remainingPaisa)}
            className={cn(
              "text-base font-bold",
              remainingPaisa > 0
                ? "text-red-600"
                : remainingPaisa < 0
                ? "text-amber-600"
                : "text-emerald-600"
            )}
          />
        </div>
        {remainingPaisa < 0 && (
          <p className="text-xs text-amber-600">
            Overpayment: change due <MoneyDisplay paisa={Math.abs(remainingPaisa)} />
          </p>
        )}

        {/* Charge button */}
        <button
          onClick={handleCharge}
          disabled={!isBalanced || closeOrderMutation.isPending}
          className={cn(
            "h-14 w-full rounded text-lg font-bold text-white transition",
            isBalanced
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
          aria-label="Charge order"
        >
          {closeOrderMutation.isPending ? "Processing…" : "CHARGE NOW"}
        </button>

        {closeOrderMutation.isError && (
          <p className="text-xs text-destructive">
            Failed to close order. Please try again.
          </p>
        )}
      </div>
    </PermissionGuard>
  );
}

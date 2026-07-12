"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";
import { useOrder, useTables } from "@/lib/hooks/pos/use-orders";
import { useOrderPayments, useRecordPayment } from "@/lib/hooks/pos/use-payments";
import {
  getOrderDisplayStatus,
  derivePaymentStatus,
  type PaymentMethod,
} from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface ChargeSummaryProps {
  orderId: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "LOYALTY_POINTS",
  "BANK_TRANSFER",
  "VOUCHER",
];

interface TenderRow {
  id: string;
  method: PaymentMethod;
  amountPaisa: number;
  referenceNo: string;
}

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function newTenderRow(amountPaisa = 0): TenderRow {
  return { id: generateKey(), method: "CASH", amountPaisa, referenceNo: "" };
}

function formatOrderTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

function orderTypeLabel(type: string): string {
  if (type === "TAKEAWAY") return "Takeaway";
  if (type === "PICKUP") return "Pickup";
  if (type === "DELIVERY") return "Delivery";
  return "Dine-in";
}

/**
 * Branches on HTTP status (not `.code`) for the PERIOD_LOCKED copy — mirrors
 * payment-panel.tsx's `getChargeErrorMessage` exactly (pos-service's
 * `PosGlobalExceptionHandler` returns an RFC7807 ProblemDetail body for
 * `PeriodLockedException`, distinct from the `{error:{code,...}}` envelope other
 * services use; the HTTP status 423 is unambiguous regardless of body shape). A
 * payment that would complete an already-Served order can trip the finance
 * period-lock check inside the backend's `maybeCloseOrder` seam (07.3-01) —
 * this page must render that as a user-facing message, never crash (T-07.3-22).
 */
function getRecordPaymentErrorMessage(error: { status?: number; message?: string } | null | undefined): string {
  if (!error) return "Failed to record payment. Please try again.";
  if (error.status === 423) {
    return "This branch's accounting period is locked. Contact your manager.";
  }
  if (typeof error.status !== "number") {
    // Not a server-shaped error (e.g. the offline-guard's plain Error) — its message
    // is already user-safe copy, not a raw server dump.
    return error.message ?? "Failed to record payment. Please try again.";
  }
  return "Failed to record payment. Please try again.";
}

/**
 * Dedicated full-page Charge surface (POS-22/25/23) — replaces the cramped narrow-width
 * `PaymentPanel` modal dialog. Shows the full order + payment analytics +
 * history, and records payments through the decoupled `recordPayment` seam (07.3-01):
 * a payment updates amount-paid/remaining/the payment chip WITHOUT closing the order —
 * the order only transitions to CLOSED server-side once it is BOTH fully Paid AND fully
 * Served (backend `maybeCloseOrder`), which this page picks up via query invalidation,
 * never by calling `closeOrder` itself.
 */
export function ChargeSummary({ orderId }: ChargeSummaryProps) {
  const router = useRouter();
  const { data: order, isLoading: orderLoading } = useOrder(orderId);
  const { data: payments = [], isLoading: paymentsLoading } = useOrderPayments(orderId);
  const { data: tables = [] } = useTables();
  const recordPayment = useRecordPayment(orderId);

  const [rows, setRows] = useState<TenderRow[]>([newTenderRow()]);
  const [recordError, setRecordError] = useState<string | null>(null);

  const amountPaidPaisa = useMemo(
    () => payments.reduce((acc, p) => acc + p.amountPaisa, 0),
    [payments],
  );

  const totalPaisa = order?.totalPaisa ?? 0;
  const remainingPaisa = Math.max(0, totalPaisa - amountPaidPaisa);
  const paymentStatus = order
    ? derivePaymentStatus(amountPaidPaisa, totalPaisa, order.status)
    : "UNPAID";
  // Duplicate-payment guard (T-07.3-21 frontend half): a paid (or refunded-terminal)
  // order blocks new tenders in the UI — the server independently rejects payment on
  // terminal orders (07.3-01 PaymentServiceImpl.recordPayment), this is defense in depth.
  const blocksNewTenders = paymentStatus === "PAID" || paymentStatus === "REFUNDED";
  const displayStatus = order ? getOrderDisplayStatus(order) : null;
  const isServed = order?.derivedStatus === "SERVED";
  const isClosed = order?.status === "CLOSED";

  const tenderTotalPaisa = rows.reduce((acc, r) => acc + r.amountPaisa, 0);
  const hasValidTenders = rows.some((r) => r.amountPaisa > 0);
  const canRecord =
    !blocksNewTenders && !isClosed && hasValidTenders && remainingPaisa > 0 && tenderTotalPaisa <= remainingPaisa;

  const tableName = order?.tableId
    ? (tables.find((t) => t.id === order.tableId)?.tableName ?? null)
    : null;

  const addRow = () => setRows((prev) => [...prev, newTenderRow()]);
  const updateRow = (id: string, patch: Partial<Omit<TenderRow, "id">>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const handleRecordPayment = async () => {
    setRecordError(null);
    const toSubmit = rows.filter((r) => r.amountPaisa > 0);
    if (toSubmit.length === 0) return;

    try {
      // The backend records ONE tender per call (POST /orders/{id}/payments) — split
      // tenders are submitted sequentially, awaiting each, so a later row never races a
      // still-in-flight earlier one against the same order's persisted-payment sum.
      for (const row of toSubmit) {
        await recordPayment.mutateAsync({
          method: row.method,
          amountPaisa: row.amountPaisa,
          referenceNo: row.referenceNo || null,
        });
      }
      toast.success(toSubmit.length > 1 ? "Payments recorded" : "Payment recorded");
      setRows([newTenderRow()]);
    } catch (err) {
      const shaped = err as { status?: number; message?: string } | undefined;
      setRecordError(getRecordPaymentErrorMessage(shaped));
    }
  };

  if (orderLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading order…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Order not found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-semibold">
                Order #{order.orderNo ?? order.id.slice(0, 8)}
              </h1>
              {isClosed ? (
                <span
                  data-testid="charge-closed-chip"
                  className="rounded-full border border-muted bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  Closed (Payment completed)
                </span>
              ) : (
                displayStatus && <StatusBadge status={displayStatus} />
              )}
              <PaymentStatusBadge status={paymentStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              {tableName ? `Table ${tableName}` : orderTypeLabel(order.type)}
              {" · "}Customer: {shortId(order.customerId)}
              {" · "}Cashier: {shortId(order.cashierId)}
              {" · "}{formatOrderTime(order.openedAt)}
            </p>
          </div>
        </div>

        {!isClosed && isServed && paymentStatus === "PAID" && (
          <p className="text-xs text-muted-foreground">
            This order is fully paid and served — it will show as Closed shortly.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Items ────────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Items</h2>
          {order.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No items on this order</p>
          ) : (
            <div className="flex flex-col divide-y">
              {order.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm font-medium",
                          item.itemStatus === "CANCELLED" && "text-muted-foreground line-through",
                        )}
                      >
                        {item.itemNameSnapshot}
                      </p>
                      {item.notes && (
                        <p className="text-xs italic text-muted-foreground">Note: {item.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs tabular-nums">×{item.quantity}</span>
                      <MoneyDisplay paisa={item.lineTotalPaisa} className="font-mono text-xs" />
                    </div>
                  </div>
                  <StatusBadge status={item.itemStatus} className="w-fit text-[10px]" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Money breakdown ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Bill</h2>
          <MoneyRow label="Subtotal" paisa={order.subtotalPaisa} />
          <MoneyRow label="Discounts" paisa={-order.discountPaisa} />
          <MoneyRow label="Service charge" paisa={order.serviceChargePaisa} />
          <MoneyRow label="Taxes" paisa={order.taxPaisa} />
          <div className="my-1 border-t" />
          <MoneyRow label="Total" paisa={order.totalPaisa} bold />
          <MoneyRow label="Amount paid" paisa={amountPaidPaisa} valueClassName="text-success" />
          <MoneyRow
            label="Remaining balance"
            paisa={remainingPaisa}
            bold
            valueClassName={remainingPaisa > 0 ? "text-destructive" : "text-success"}
          />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Payment history ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Payment History</h2>
          {paymentsLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading payments…</p>
          ) : payments.length === 0 ? (
            <p data-testid="no-payments-empty-state" className="py-4 text-center text-sm text-muted-foreground">
              No payments yet
            </p>
          ) : (
            <div className="flex flex-col divide-y" data-testid="payment-history-rows">
              {payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{payment.method.replace("_", " ")}</span>
                    <span className="text-xs text-muted-foreground">
                      {payment.referenceNo ? `Ref: ${payment.referenceNo} · ` : ""}
                      {formatOrderTime(payment.recordedAt)}
                    </span>
                  </div>
                  <MoneyDisplay paisa={payment.amountPaisa} className="font-mono text-sm" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Take payment ─────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Take Payment</h2>

          {blocksNewTenders ? (
            <p data-testid="payment-blocked-message" className="text-sm text-muted-foreground">
              This order is {paymentStatus === "REFUNDED" ? "refunded" : "fully paid"} — no further tenders
              can be recorded.
            </p>
          ) : isClosed ? (
            <p className="text-sm text-muted-foreground">This order is closed.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {rows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.method}
                      onChange={(e) => updateRow(row.id, { method: e.target.value as PaymentMethod })}
                      aria-label="Payment method"
                      className="w-36 flex-none rounded border bg-background px-2 py-1.5 text-sm"
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
                      aria-label="Amount in paisa"
                      className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={row.referenceNo}
                      onChange={(e) => updateRow(row.id, { referenceNo: e.target.value })}
                      placeholder="Ref# (optional)"
                      aria-label="Reference number"
                      className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        aria-label="Remove tender"
                        className="px-1 text-lg text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addRow}
                className="self-start text-sm text-primary underline"
              >
                + Add tender
              </button>

              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Tender total</span>
                <MoneyDisplay paisa={tenderTotalPaisa} className="font-semibold" />
              </div>
              {tenderTotalPaisa > remainingPaisa && (
                <p className="text-xs text-destructive">
                  Tender total exceeds the remaining balance.
                </p>
              )}

              <button
                type="button"
                data-testid="record-payment-button"
                onClick={() => void handleRecordPayment()}
                disabled={!canRecord || recordPayment.isPending}
                className={cn(
                  "h-12 w-full rounded-xl text-sm font-semibold transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  "bg-primary text-primary-foreground enabled:hover:bg-primary/90 enabled:active:scale-[0.98]",
                )}
              >
                {recordPayment.isPending ? "Recording…" : "Record Payment"}
              </button>

              {recordError && (
                <p data-testid="record-payment-error" className="text-xs text-destructive" role="alert">
                  {recordError}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Money row ──────────────────────────────────────────────────────────────────

interface MoneyRowProps {
  label: string;
  paisa: number;
  bold?: boolean;
  valueClassName?: string;
}

function MoneyRow({ label, paisa, bold, valueClassName }: MoneyRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>{label}</span>
      <MoneyDisplay
        paisa={Math.abs(paisa)}
        className={cn(bold && "font-semibold", valueClassName)}
      />
    </div>
  );
}

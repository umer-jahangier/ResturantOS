"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";
import { useOrder, useTables, useSendToKds, useServeAllItems } from "@/lib/hooks/pos/use-orders";
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

/**
 * The tenders a cashier may actually select.
 *
 * <h3>GA-006 — why `LOYALTY_POINTS` is not in this list</h3>
 *
 * It was, and selecting it gave the food away for free while corrupting the general ledger.
 * Nothing anywhere validated a points balance: `PaymentServiceImpl`'s only Feign client is
 * `FinanceArClient` — it has **no CRM dependency at all** — and its validation checks the ORDER
 * balance only, never the customer's points. `GET /api/v1/crm/loyalty` returns 404 and
 * `LoyaltyService` has no `redeem` method. Meanwhile `AutoPostingRecipeEngine:598` books the
 * tender to `LOYALTY_LIABILITY`, so every use also posted a liability with no points movement
 * behind it. A cashier could settle any order, of any size, with points the customer does not
 * have — and the books would balance to a lie.
 *
 * Implementing redemption is 4 days and belongs to Phase 17, which owns `LoyaltyService.redeem`.
 * Removing the button is one line. **Shipping a tender that cannot be paid for is worse than not
 * offering it**, so the button goes now and comes back the day the endpoint exists.
 *
 * <h3>What was deliberately NOT done</h3>
 *
 * `LOYALTY_POINTS` remains a member of the `PaymentMethod` union and of both Zod payment schemas.
 * Orders already settled with it exist in `pos_db`, and narrowing the type would make those rows
 * fail to parse — turning a UI defect into a data-display outage on historical orders. This list
 * governs what a cashier may CHOOSE; every read path still renders the value correctly.
 */
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "VOUCHER"];

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
 * Branches on HTTP status (not `.code`) for the PERIOD_LOCKED copy — pos-service's own
 * `PosGlobalExceptionHandler` returns an RFC7807 ProblemDetail body for
 * `PeriodLockedException`, distinct from the `{error:{code,...}}` envelope other
 * services use; the HTTP status 423 is unambiguous regardless of body shape. A
 * payment that would complete an already-Served order can trip the finance
 * period-lock check inside the backend's `maybeCloseOrder` seam (07.3-01) —
 * this page must render that as a user-facing message, never crash (T-07.3-22).
 */
function getRecordPaymentErrorMessage(
  error: { status?: number; message?: string } | null | undefined,
): string {
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
 * Copy for the close CTA's refusals. The server answers with a 409 whose message names the
 * cause; the cashier needs the ACTION, not the cause, so each refusal is mapped to the thing
 * they should do next. Anything unrecognised keeps its server message — a wrong-but-specific
 * sentence beats a right-but-useless one when someone is standing at a till.
 */
function getCloseErrorMessage(
  error: { status?: number; message?: string } | null | undefined,
): string {
  if (!error) return "Couldn't close the order. Please try again.";
  if (error.status === 423) {
    return "This branch's accounting period is locked, so the order can't be closed. Contact your manager.";
  }
  if (typeof error.message === "string" && error.message.includes("not been fired")) {
    return "Some items were never sent to the kitchen. Send them first, then close the order.";
  }
  return error.message ?? "Couldn't close the order. Please try again.";
}

/**
 * Dedicated full-page Charge surface (POS-22/25/23). Shows the full order + payment
 * analytics + history, and records payments through the decoupled `recordPayment` seam
 * (07.3-01): a payment updates amount-paid/remaining/the payment chip WITHOUT closing
 * the order — the order only transitions to CLOSED server-side once it is BOTH fully
 * Paid AND fully Served (backend `maybeCloseOrder`), which this page picks up via query
 * invalidation.
 *
 * <h3>S0-06 — why this page carries a close control</h3>
 *
 * The Paid-AND-Served rule is right; what was missing was any way for the person settling the
 * check to supply the Served half. `Mark Served` existed only per line, on the terminal's order
 * panel and the order drawer — two screens a cashier is not on once they have pressed CHARGE
 * NOW. So the ordinary end state of a settled order was `SENT_TO_KDS / PAID`: open indefinitely,
 * still offering Void, and refused by Refund. This page finishes the transaction, so this page
 * is where "the food is with the guest, close it" belongs. It still does not call a close
 * endpoint — there is none — it serves the lines and the server closes as a consequence.
 */
export function ChargeSummary({ orderId }: ChargeSummaryProps) {
  const router = useRouter();
  const { data: order, isLoading: orderLoading } = useOrder(orderId);
  const { data: payments = [], isLoading: paymentsLoading } = useOrderPayments(orderId);
  const { data: tables = [] } = useTables();
  const recordPayment = useRecordPayment(orderId);
  const sendToKds = useSendToKds(orderId);
  const serveAll = useServeAllItems(orderId);

  const [rows, setRows] = useState<TenderRow[]>([newTenderRow()]);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

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
  const isClosed = order?.status === "CLOSED";

  // S0-06 close CTA. Offered when the bill is settled and the order is not yet terminal —
  // the exact state a cashier is left in after CHARGE NOW, and the state the register found
  // orders sitting in "for over an hour".
  const activeItems = useMemo(
    () => (order?.items ?? []).filter((i) => i.itemStatus !== "CANCELLED"),
    [order],
  );
  const unfiredItems = activeItems.filter((i) => i.itemStatus === "PENDING");
  const isTerminal =
    order?.status === "CLOSED" || order?.status === "VOIDED" || order?.status === "REFUNDED";
  const showCloseCta = !!order && !isTerminal && paymentStatus === "PAID";
  const canClose = showCloseCta && activeItems.length > 0 && unfiredItems.length === 0;

  const tenderTotalPaisa = rows.reduce((acc, r) => acc + r.amountPaisa, 0);
  const hasValidTenders = rows.some((r) => r.amountPaisa > 0);
  const canRecord =
    !blocksNewTenders &&
    !isClosed &&
    hasValidTenders &&
    remainingPaisa > 0 &&
    tenderTotalPaisa <= remainingPaisa;

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

      // Charge-Now pay-then-fire (#4): if this payment fully covers the order AND the order was
      // never sent to the kitchen (sentToKdsAt == null → the pre-send Charge Now path), fire its
      // still-PENDING lines now that it's paid. An order that was already sent earlier (dine-in)
      // has sentToKdsAt set, so it is NEVER re-fired here — the two flows stay fully isolated.
      const submittedTotal = toSubmit.reduce((acc, r) => acc + r.amountPaisa, 0);
      const willBeFullyPaid = totalPaisa > 0 && amountPaidPaisa + submittedTotal >= totalPaisa;
      const pendingUnfired = order?.items.filter((i) => i.itemStatus === "PENDING") ?? [];
      if (willBeFullyPaid && order && order.sentToKdsAt === null && pendingUnfired.length > 0) {
        try {
          await sendToKds.mutateAsync();
          toast.success("Sent to kitchen");
        } catch {
          toast.error("Paid, but sending to kitchen failed — retry from Order Management.");
        }
      }
    } catch (err) {
      const shaped = err as { status?: number; message?: string } | undefined;
      setRecordError(getRecordPaymentErrorMessage(shaped));
    }
  };

  const handleCloseOrder = async () => {
    setCloseError(null);
    try {
      await serveAll.mutateAsync();
      toast.success("Order closed");
    } catch (err) {
      setCloseError(getCloseErrorMessage(err as { status?: number; message?: string } | undefined));
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
              {" · "}
              {formatOrderTime(order.openedAt)}
            </p>
          </div>
        </div>

        {/*
          S0-06: this used to read "fully paid and served — it will show as Closed shortly."
          It never did. The order was paid and NOT served (nothing on a cashier's path serves a
          line), so the sentence rendered only in a state the server would already have closed —
          i.e. almost never — and promised an automatic transition that had no trigger. The
          promise is replaced by the button in Take Payment that actually performs it.
        */}
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
            testId="remaining-balance-value"
          />

          {/*
            Print bill (26-05). Sited here, at the end of the bill breakdown, because that is where
            the cashier's eye already is at the moment the customer asks for it.

            Offered as soon as SOMETHING has been paid, not only once the order is CLOSED: a
            customer asks for the bill at the moment they hand over money, and an order stays open
            until it is both fully paid AND fully served. Requiring CLOSED would mean the paper is
            unavailable at exactly the moment it is wanted.

            Navigation only — no printing happens here. The receipt route owns the document, the
            80mm stylesheet and the print dialog, and it is a POST that writes a print_jobs row, so
            it must not be triggered as a side effect of rendering this screen.
          */}
          {amountPaidPaisa > 0 && (
            <button
              type="button"
              data-testid="print-bill-button"
              onClick={() => router.push(`/app/pos/orders/${orderId}/receipt`)}
              className={cn(
                "mt-2 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl",
                "border text-sm font-medium transition-all",
                "hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
              )}
            >
              <Printer className="size-4" aria-hidden="true" />
              Print bill
            </button>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Payment history ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Payment History</h2>
          {paymentsLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading payments…</p>
          ) : payments.length === 0 ? (
            <p
              data-testid="no-payments-empty-state"
              className="py-4 text-center text-sm text-muted-foreground"
            >
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
            <>
              <p data-testid="payment-blocked-message" className="text-sm text-muted-foreground">
                This order is {paymentStatus === "REFUNDED" ? "refunded" : "fully paid"} — no
                further tenders can be recorded.
              </p>

              {/*
                S0-06 — the end of the transaction, sited where the cashier's hand already is
                (directly under the tender they just took), not on a screen they would have to
                navigate to. Primary weight, full width, same 48px target as Record Payment:
                this is now the last step of taking money, so it gets the last step's emphasis.
              */}
              {showCloseCta && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <button
                    type="button"
                    data-testid="close-order-button"
                    onClick={() => void handleCloseOrder()}
                    disabled={!canClose || serveAll.isPending}
                    className={cn(
                      "h-12 w-full rounded-xl text-sm font-semibold transition-all",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                      "bg-success text-success-foreground enabled:hover:bg-success/90 enabled:active:scale-[0.98]",
                    )}
                  >
                    {serveAll.isPending ? "Closing…" : "Mark served & close order"}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {canClose
                      ? "Confirms the food reached the guest and closes the check. After this the order can be refunded, not voided."
                      : unfiredItems.length > 0
                        ? `${unfiredItems.length} item(s) were never sent to the kitchen — send them before closing.`
                        : "This order has no active items to serve."}
                  </p>
                  {closeError && (
                    <p data-testid="close-order-error" className="text-xs text-destructive" role="alert">
                      {closeError}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : isClosed ? (
            <p className="text-sm text-muted-foreground">This order is closed.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {rows.map((row, index) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.method}
                      onChange={(e) =>
                        updateRow(row.id, { method: e.target.value as PaymentMethod })
                      }
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
                    {index === 0 && remainingPaisa > 0 && (
                      <button
                        type="button"
                        data-testid="fill-full-amount-button"
                        onClick={() => updateRow(row.id, { amountPaisa: remainingPaisa })}
                        className="whitespace-nowrap rounded border px-2 py-1.5 text-xs text-primary hover:bg-primary/5"
                      >
                        Full amount
                      </button>
                    )}
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
                <p
                  data-testid="record-payment-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
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
  /** Optional testid + raw-paisa data attribute on the value element (E2E hook — the
   * formatted `MoneyDisplay` currency string alone isn't reliably machine-parseable). */
  testId?: string;
}

function MoneyRow({ label, paisa, bold, valueClassName, testId }: MoneyRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>
        {label}
      </span>
      {/* Outer span carries the E2E hook (testid + raw paisa) — MoneyDisplay itself
          only ever renders the formatted currency string, not a machine-parseable one. */}
      <span data-testid={testId} data-paisa={Math.abs(paisa)}>
        <MoneyDisplay
          paisa={Math.abs(paisa)}
          className={cn(bold && "font-semibold", valueClassName)}
        />
      </span>
    </div>
  );
}

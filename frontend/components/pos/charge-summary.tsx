"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";
import { DiscountPanel } from "@/components/pos/discount-panel";
import { useOrder, useTables, useSendToKds, useServeAllItems } from "@/lib/hooks/pos/use-orders";
import { useOrderPayments, useRecordPayment } from "@/lib/hooks/pos/use-payments";
import { BillIssuedStrip } from "@/components/pos/bill-issued-strip";
import { useOrderPrintHistory } from "@/lib/hooks/pos/use-order-bill";
import { billIssues, originalBill } from "@/lib/models/order-bill.model";
import {
  getOrderDisplayStatus,
  derivePaymentStatus,
  type PaymentMethod,
} from "@/lib/models/pos.model";
import { formatServiceChargeRate } from "@/lib/models/service-charge.model";
import { paisaToRupeeInput, parseRupeesToPaisa } from "@/lib/adapters/shared";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format/locale";

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

/**
 * <h3>S1-05 — the tender row is denominated in RUPEES, and holds text, not a number</h3>
 *
 * Both halves of that sentence are the fix.
 *
 * The unit: this row used to carry `amountPaisa`, fed by an input whose accessible name was
 * literally "Amount in paisa". A Rs 3,456.80 bill had to be entered as `345680`, and `Full amount`
 * prefilled that integer. Nobody reads a bill in paisa, so the cashier was doing a ×100 in their
 * head on a touchscreen with a queue behind them.
 *
 * The type: the old input was `type="number"` with `parseInt(e.target.value)`. Typing `3456.80`
 * key by key put `34560` in the box — a Rs 345.60 tender against a Rs 3,456.80 check, silently,
 * with no error anywhere. (`type="number"` reports `.value === ""` while the text buffer holds the
 * intermediate `3456.`, so `parseInt` read 0 and the digits after the point landed on an emptied
 * field.) Verified in Chromium before the fix, not reasoned about. Keeping the raw text and
 * parsing it once, at the boundary, is what makes that class of corruption impossible.
 */
interface TenderRow {
  id: string;
  method: PaymentMethod;
  /** RUPEES, exactly as typed. Converted to paisa once, by {@link parseRupeesToPaisa}. */
  amountText: string;
  /** RUPEES handed over. CASH only — every other method is hidden AND ignored. */
  tenderedText: string;
  /**
   * RUPEES of tip, taken ON TOP of {@link amountText} (F20). Rupees and raw text for exactly the
   * reasons the two fields above are: nobody reads a tip in paisa, and `type="number"` swallows
   * the digits after a decimal point key by key.
   */
  tipText: string;
  referenceNo: string;
}

/**
 * One row's money, read out of its text. `amountPaisa === null` means the box holds something that
 * is not an amount — which must block the tender, never quietly become zero.
 */
interface TenderReading {
  amountPaisa: number | null;
  amountInvalid: boolean;
  /** null when the cashier has not said what was handed over (or the method has no drawer). */
  tenderedPaisa: number | null;
  tenderedInvalid: boolean;
  /** The tip, in paisa. 0 when the box is empty; null-invalid is reported separately. */
  tipPaisa: number;
  tipInvalid: boolean;
  /** tendered − amount − tip, floored at 0. */
  changePaisa: number;
  /** amount + tip − tendered, floored at 0: the guest has not handed over enough. */
  shortPaisa: number;
}

/**
 * Which tenders can carry a tip (F20).
 *
 * <p>Not every one. LOYALTY_POINTS spends a liability the guest already owns and
 * CHARGE_TO_ACCOUNT bills a house account later — neither puts money in the drawer or on a card
 * slip now, so a tip on one would be a liability to staff funded by nothing. The server refuses
 * both with a 422 naming the field; this hides the box so the cashier never types into it.
 */
function methodAcceptsTip(method: PaymentMethod): boolean {
  return method !== "LOYALTY_POINTS" && method !== "CHARGE_TO_ACCOUNT";
}

function readTender(row: TenderRow): TenderReading {
  const amountPaisa = row.amountText.trim() === "" ? 0 : parseRupeesToPaisa(row.amountText);
  const isCash = row.method === "CASH";
  const tenderedBlank = row.tenderedText.trim() === "";
  const tenderedPaisa = !isCash || tenderedBlank ? null : parseRupeesToPaisa(row.tenderedText);
  // A tip on a method that cannot carry one is not merely hidden, it is not READ — otherwise
  // switching the method after typing a tip would still send it and earn a 422.
  const tipBlank = row.tipText.trim() === "";
  const tipRead =
    !methodAcceptsTip(row.method) || tipBlank ? null : parseRupeesToPaisa(row.tipText);
  const tipPaisa = tipRead ?? 0;
  // The guest hands over the bill AND the tip. Change is what is left after both, which is what
  // the server computes (`tendered - applied - tip`) and what the drawer will actually contain.
  const delta =
    amountPaisa !== null && tenderedPaisa !== null ? tenderedPaisa - amountPaisa - tipPaisa : 0;
  return {
    amountPaisa,
    amountInvalid: amountPaisa === null,
    tenderedPaisa,
    tenderedInvalid: isCash && !tenderedBlank && tenderedPaisa === null,
    tipPaisa,
    tipInvalid: methodAcceptsTip(row.method) && !tipBlank && tipRead === null,
    changePaisa: Math.max(0, delta),
    shortPaisa: Math.max(0, -delta),
  };
}

/**
 * The notes that come out of a Pakistani wallet. Quick-keys ADD, so Rs 1,000 + Rs 500 + Rs 500 is
 * three taps and reads like the stack of paper actually on the counter — which is how a cashier
 * counts, and why "set" would be the wrong verb here.
 */
const CASH_DENOMINATIONS: { paisa: number; label: string }[] = [
  { paisa: 5000, label: "50" },
  { paisa: 10000, label: "100" },
  { paisa: 50000, label: "500" },
  { paisa: 100000, label: "1,000" },
  { paisa: 500000, label: "5,000" },
];

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function newTenderRow(amountText = ""): TenderRow {
  return {
    id: generateKey(),
    method: "CASH",
    amountText,
    tenderedText: "",
    tipText: "",
    referenceNo: "",
  };
}

function formatOrderTime(value: string | null): string {
  return formatDateTime(value, { dateStyle: "medium", timeStyle: "short" });
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
  const { data: order, isLoading: orderLoading, isError: orderFailed } = useOrder(orderId);
  const {
    data: payments = [],
    isLoading: paymentsLoading,
    isError: paymentsFailed,
  } = useOrderPayments(orderId);
  const { data: tables = [] } = useTables();
  const recordPayment = useRecordPayment(orderId);
  const sendToKds = useSendToKds(orderId);
  const serveAll = useServeAllItems(orderId);
  // §3-3: what paper this check has actually produced. A pure GET — asking must never be what
  // creates a bill, which is why this is not `useIssueReceipt`.
  const billHistory = useOrderPrintHistory(orderId);

  const [rows, setRows] = useState<TenderRow[]>([newTenderRow()]);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const amountPaidPaisa = useMemo(
    () => payments.reduce((acc, p) => acc + p.amountPaisa, 0),
    [payments],
  );

  const totalPaisa = order?.totalPaisa ?? 0;
  // S0-01: `amountPaidPaisa` nets refund reversals, so a fully-refunded order reads Rs 0.00 paid
  // — correct — but the naive remainder then climbed back to the full bill and printed
  // "Remaining balance Rs 499.00" on an order nobody owes anything on. A settled-away order
  // (REFUNDED or VOIDED) is not collectable, so its remainder is zero by definition.
  const isUncollectable = order?.status === "REFUNDED" || order?.status === "VOIDED";
  const remainingPaisa = isUncollectable ? 0 : Math.max(0, totalPaisa - amountPaidPaisa);
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

  // One reading per row, computed once and shared by the markup, the guards and the submit —
  // so what the cashier sees on screen and what leaves for the server can never be two different
  // numbers derived two different ways.
  const readings = rows.map(readTender);
  const tenderTotalPaisa = readings.reduce((acc, r) => acc + (r.amountPaisa ?? 0), 0);
  const changeDueTotalPaisa = readings.reduce((acc, r) => acc + r.changePaisa, 0);
  const hasValidTenders = readings.some((r) => (r.amountPaisa ?? 0) > 0);
  const anyUnparseable = readings.some((r) => r.amountInvalid || r.tenderedInvalid || r.tipInvalid);
  // F20. Shown beside the total so the cashier can read back the whole figure the guest is about
  // to part with — the bill and the tip are two numbers and the card machine only asks for one.
  const tipTotalPaisa = readings.reduce((acc, r) => acc + r.tipPaisa, 0);
  // A cash row whose tendered is BELOW its applied amount is a mis-key, not an under-payment: the
  // server would silently raise the tender to the applied amount (PaymentServiceImpl clamps with
  // Math.max), and the drawer would then be reconciled against money that was never handed over.
  const anyShortTender = readings.some((r) => r.shortPaisa > 0);
  const canRecord =
    !blocksNewTenders &&
    !isClosed &&
    hasValidTenders &&
    !anyUnparseable &&
    !anyShortTender &&
    remainingPaisa > 0 &&
    tenderTotalPaisa <= remainingPaisa;

  const tableName = order?.tableId
    ? (tables.find((t) => t.id === order.tableId)?.tableName ?? null)
    : null;

  // The ORIGINAL bill — the paper the guest was handed — and how many copies followed it.
  const bill = originalBill(billHistory.data ?? []);
  const reprintCount = billIssues(billHistory.data ?? []).filter((i) => i.issueSeq > 1).length;

  const addRow = () => setRows((prev) => [...prev, newTenderRow()]);
  const updateRow = (id: string, patch: Partial<Omit<TenderRow, "id">>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  /** Quick-keys add a note to what is already on the counter (see CASH_DENOMINATIONS). */
  const addDenomination = (id: string, paisa: number) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              tenderedText: paisaToRupeeInput((parseRupeesToPaisa(r.tenderedText) ?? 0) + paisa),
            }
          : r,
      ),
    );

  const handleRecordPayment = async () => {
    setRecordError(null);
    const toSubmit = rows
      .map((row, index) => ({ row, reading: readings[index]! }))
      .filter(({ reading }) => (reading.amountPaisa ?? 0) > 0);
    if (toSubmit.length === 0 || anyUnparseable || anyShortTender) return;

    try {
      // The backend records ONE tender per call (POST /orders/{id}/payments) — split
      // tenders are submitted sequentially, awaiting each, so a later row never races a
      // still-in-flight earlier one against the same order's persisted-payment sum.
      for (const { row, reading } of toSubmit) {
        await recordPayment.mutateAsync({
          method: row.method,
          amountPaisa: reading.amountPaisa!,
          // CASH only, and only when the cashier actually said what was handed over. On any other
          // method a tender above the balance is an input error the server answers with a 422
          // (PaymentServiceImpl.PaymentExceedsBalanceException) — there is no drawer to give
          // change from, so the field is neither shown nor sent.
          ...(row.method === "CASH" && reading.tenderedPaisa !== null
            ? { tenderedPaisa: reading.tenderedPaisa }
            : {}),
          // F20. Sent only when there is one, so an ordinary tender's request body is byte-for-byte
          // what it was before this feature existed.
          ...(reading.tipPaisa > 0 ? { tipPaisa: reading.tipPaisa } : {}),
          referenceNo: row.referenceNo || null,
        });
      }
      toast.success(toSubmit.length > 1 ? "Payments recorded" : "Payment recorded");
      setRows([newTenderRow()]);

      // §3-3: settling in full dispatches the bill after the payment transaction commits — which
      // has already happened by the time this promise resolves, because the after-commit callback
      // runs inside the request. Re-read rather than assume: the strip must report what the server
      // did, not what this screen expected it to do.
      void billHistory.refetch();

      // Charge-Now pay-then-fire (#4): if this payment fully covers the order AND the order was
      // never sent to the kitchen (sentToKdsAt == null → the pre-send Charge Now path), fire its
      // still-PENDING lines now that it's paid. An order that was already sent earlier (dine-in)
      // has sentToKdsAt set, so it is NEVER re-fired here — the two flows stay fully isolated.
      const submittedTotal = toSubmit.reduce(
        (acc, { reading }) => acc + (reading.amountPaisa ?? 0),
        0,
      );
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

  /*
   * Before `!order`, because `!order` renders "Order not found." — on the CHARGE screen, to a
   * cashier holding the bill in their hand (GA-001). The check exists; the request did not
   * answer. Told the first sentence, the operator re-rings the whole order.
   */
  if (orderFailed) {
    return (
      <div
        role="alert"
        data-testid="charge-order-unavailable"
        className="m-4 flex h-64 items-center justify-center rounded-md border border-destructive/30 bg-destructive/15 p-4 text-center text-small font-medium text-destructive"
      >
        Couldn&apos;t read this check. It has NOT been cancelled — do not re-ring it. Try again in a
        moment.
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
          {/*
            B3 — the control the Discounts line above never had.

            Sited directly under the figure it changes, because that is the line the cashier and
            the guest are both looking at when the question is asked. It is not on the terminal:
            a discount is decided when the bill is presented, and by then the terminal has moved
            on to the next table. `DiscountPanel` renders nothing at all on a settled or written-
            off check, and nothing for a persona holding neither discount permission.
          */}
          <DiscountPanel order={order} />
          {/*
            F20 — the line that used to print `Service charge Rs 0.00` on every check ever rung.

            The rule is "label OR money". A non-null label means the branch HAS a service charge
            on this check, so the row shows even at Rs 0.00 — a fully-comped 5% check genuinely
            owes nothing and the guest is still entitled to the line that says so. A non-zero
            amount shows regardless, so money can never silently vanish off a bill. What is gone
            is the third case, which was every check ever rung: no label AND no money.

            The percentage is printed beside the label because "Service charge Rs 49.90" invites
            "of what?" from the person paying, and the cashier standing in front of them needs the
            answer on the same screen.
          */}
          {(order.serviceChargeLabel || order.serviceChargePaisa !== 0) && (
            <MoneyRow
              label={
                order.serviceChargePct > 0
                  ? `${order.serviceChargeLabel ?? "Service charge"} (${formatServiceChargeRate(order.serviceChargePct)})`
                  : (order.serviceChargeLabel ?? "Service charge")
              }
              paisa={order.serviceChargePaisa}
            />
          )}
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
            <>
              <BillIssuedStrip
                isLoading={billHistory.isLoading}
                isError={billHistory.isError}
                onRetry={() => void billHistory.refetch()}
                bill={bill}
                reprintCount={reprintCount}
              />
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
                {bill ? "Print another copy" : "Print bill"}
              </button>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Payment history ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Payment History</h2>
          {paymentsLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading payments…</p>
          ) : paymentsFailed ? (
            /*
             * Checked BEFORE the empty branch, and this is the highest-stakes instance of that
             * ordering in the product (GA-001). `data: payments = []` turned a failed read into
             * an empty history one line later, and this panel then said "No payments yet" on a
             * bill that had already been settled. The next thing a cashier does with that
             * sentence is take the money again.
             */
            <p
              role="alert"
              data-testid="payments-unavailable"
              className="rounded-md border border-destructive/30 bg-destructive/15 py-4 text-center text-small font-medium text-destructive"
            >
              Payment history unavailable — do not take payment until this loads.
            </p>
          ) : payments.length === 0 ? (
            <p
              data-testid="no-payments-empty-state"
              className="py-4 text-center text-sm text-muted-foreground"
            >
              No payments yet
            </p>
          ) : (
            <div className="flex flex-col divide-y" data-testid="payment-history-rows">
              {payments.map((payment) => {
                // S0-01: the history now carries refund reversals alongside tenders. A reversal
                // is a negative row, so it has to READ as money going back rather than as another
                // charge — otherwise a refunded bill still looks settled on the screen the
                // cashier trusts.
                const isRefund = payment.kind === "REFUND";
                return (
                  <div
                    key={payment.id}
                    data-testid={isRefund ? "refund-history-row" : "payment-history-row"}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {isRefund
                          ? `Refund · ${payment.method.replace("_", " ")}`
                          : payment.method.replace("_", " ")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {payment.referenceNo
                          ? `${isRefund ? "Reason" : "Ref"}: ${payment.referenceNo} · `
                          : ""}
                        {formatOrderTime(payment.recordedAt)}
                      </span>
                      {/*
                        F20 — the tip, on its own line under the tender that carried it. It is NOT
                        added into the amount on the right: that column is what settled the bill,
                        it is summed into "Amount paid" above, and a tip settles none of the bill.
                        Showing them added together would make a Rs 998 check look Rs 1,048 paid
                        and the remaining balance wrong by the tip.
                      */}
                      {payment.tipPaisa > 0 && (
                        <span
                          data-testid="payment-history-tip"
                          data-paisa={payment.tipPaisa}
                          className="text-xs text-muted-foreground"
                        >
                          {/*
                            The tip amount goes through <MoneyDisplay>, not `formatPaisa`
                            interpolated into the caption. It is a JSX child position, so the
                            element fits with no restructuring, and the rendered text is
                            unchanged — the e2e probes that read this node's `textContent` and
                            its `data-paisa` see exactly what they saw before.
                          */}
                          Tip <MoneyDisplay paisa={payment.tipPaisa} /> — held for staff, not part
                          of the bill
                        </span>
                      )}
                    </div>
                    <MoneyDisplay
                      paisa={payment.amountPaisa}
                      className={cn("font-mono text-sm", isRefund && "text-warning")}
                    />
                  </div>
                );
              })}
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
                    <p
                      data-testid="close-order-error"
                      className="text-xs text-destructive"
                      role="alert"
                    >
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
              <div className="flex flex-col gap-3">
                {rows.map((row, index) => {
                  const reading = readings[index]!;
                  const isCash = row.method === "CASH";
                  return (
                    <div
                      key={row.id}
                      data-testid="tender-row"
                      className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-none flex-col gap-1 text-xs text-muted-foreground">
                          Method
                          <select
                            value={row.method}
                            onChange={(e) =>
                              updateRow(row.id, { method: e.target.value as PaymentMethod })
                            }
                            aria-label="Payment method"
                            className="h-11 w-36 rounded-lg border bg-background px-2 text-sm text-foreground"
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {m.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                        </label>

                        {/*
                          type="text" + inputMode="decimal", NOT type="number". A number input
                          reports `.value === ""` for the intermediate "3456." keystroke, which is
                          how the old parseInt handler turned a typed Rs 3,456.80 into Rs 345.60.
                          inputMode still raises the numeric keypad on the till's touchscreen.
                        */}
                        <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                          Amount (Rs)
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={row.amountText}
                            onChange={(e) => updateRow(row.id, { amountText: e.target.value })}
                            placeholder="0.00"
                            aria-label="Amount (Rs)"
                            aria-invalid={reading.amountInvalid || undefined}
                            className={cn(
                              "h-11 rounded-lg border bg-background px-2 text-right font-mono text-sm tabular-nums text-foreground",
                              reading.amountInvalid && "border-destructive",
                            )}
                          />
                        </label>

                        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                          Ref# (optional)
                          <input
                            type="text"
                            value={row.referenceNo}
                            onChange={(e) => updateRow(row.id, { referenceNo: e.target.value })}
                            placeholder="Card / slip no."
                            aria-label="Reference number"
                            className="h-11 rounded-lg border bg-background px-2 text-sm text-foreground"
                          />
                        </label>

                        {index === 0 && remainingPaisa > 0 && (
                          <button
                            type="button"
                            data-testid="fill-full-amount-button"
                            onClick={() =>
                              updateRow(row.id, { amountText: paisaToRupeeInput(remainingPaisa) })
                            }
                            className="h-11 whitespace-nowrap rounded-lg border px-3 text-xs font-medium text-primary hover:bg-primary/5"
                          >
                            Full amount
                          </button>
                        )}
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            aria-label="Remove tender"
                            className="h-11 px-2 text-lg text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {reading.amountInvalid && (
                        <p
                          data-testid="amount-invalid-message"
                          aria-live="polite"
                          className="text-xs text-destructive"
                        >
                          Enter the amount in rupees, like 3456.80.
                        </p>
                      )}

                      {/*
                        F20 — the tip. Sited under the amount, ABOVE the cash-only tendered block,
                        because a tip is asked for on card as often as on cash and the guest says
                        it at the moment the amount is agreed.

                        It is deliberately NOT a row of percentage quick-keys. A percentage of the
                        bill is a service charge and the restaurant sets that once, on the settings
                        screen; a tip is a number the guest says out loud, and offering "10% / 15% /
                        20%" on a Pakistani till would be the product nudging a guest on the
                        cashier's behalf.
                      */}
                      {methodAcceptsTip(row.method) && (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                            Tip (Rs) — optional
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={row.tipText}
                              onChange={(e) => updateRow(row.id, { tipText: e.target.value })}
                              placeholder="For the staff, on top of the bill"
                              aria-label="Tip (Rs)"
                              aria-invalid={reading.tipInvalid || undefined}
                              data-testid="tip-input"
                              className={cn(
                                "h-11 rounded-lg border bg-background px-2 text-right font-mono text-sm tabular-nums text-foreground",
                                reading.tipInvalid && "border-destructive",
                              )}
                            />
                          </label>
                          {reading.tipPaisa > 0 && (
                            <div className="flex flex-none flex-col items-end gap-1">
                              <span className="text-xs text-muted-foreground">
                                {row.method === "CASH" ? "Into the drawer" : "Off the card"}
                              </span>
                              <span
                                data-testid="tender-plus-tip-value"
                                data-paisa={(reading.amountPaisa ?? 0) + reading.tipPaisa}
                                className="flex h-11 items-center"
                              >
                                <MoneyDisplay
                                  paisa={(reading.amountPaisa ?? 0) + reading.tipPaisa}
                                  className="font-mono text-lg font-semibold"
                                />
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {reading.tipInvalid && (
                        <p
                          data-testid="tip-invalid-message"
                          aria-live="polite"
                          className="text-xs text-destructive"
                        >
                          Enter the tip in rupees, like 50 or 50.00. Leave it blank for no tip.
                        </p>
                      )}

                      {/*
                        Tendered + change, CASH only. A card has no drawer: printing a change line
                        under one invites "where is my change?" at the counter (the same reasoning
                        receipt-document.tsx applies when it suppresses Tendered/Change at zero).
                      */}
                      {isCash && (
                        <div className="flex flex-col gap-2 border-t pt-3">
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                              Tendered (Rs)
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={row.tenderedText}
                                onChange={(e) =>
                                  updateRow(row.id, { tenderedText: e.target.value })
                                }
                                placeholder="What the guest handed over"
                                aria-label="Tendered (Rs)"
                                aria-invalid={reading.tenderedInvalid || undefined}
                                className={cn(
                                  "h-11 rounded-lg border bg-background px-2 text-right font-mono text-sm tabular-nums text-foreground",
                                  reading.tenderedInvalid && "border-destructive",
                                )}
                              />
                            </label>
                            <div className="flex flex-none flex-col items-end gap-1">
                              <span className="text-xs text-muted-foreground">Change due</span>
                              <span
                                data-testid="change-due-value"
                                data-paisa={reading.changePaisa}
                                className="flex h-11 items-center"
                              >
                                <MoneyDisplay
                                  paisa={reading.changePaisa}
                                  className={cn(
                                    "font-mono text-lg font-semibold",
                                    reading.changePaisa > 0
                                      ? "text-success"
                                      : "text-muted-foreground",
                                  )}
                                />
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="mr-1 text-xs text-muted-foreground">Quick tender</span>
                            {CASH_DENOMINATIONS.map((d) => (
                              <button
                                key={d.paisa}
                                type="button"
                                data-testid={`denom-${d.paisa}`}
                                onClick={() => addDenomination(row.id, d.paisa)}
                                className="h-9 min-w-[3.25rem] rounded-lg border px-2 font-mono text-xs font-medium tabular-nums hover:bg-accent hover:text-accent-foreground active:scale-95"
                              >
                                +{d.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              data-testid="denom-exact"
                              onClick={() =>
                                updateRow(row.id, {
                                  tenderedText:
                                    reading.amountPaisa === null
                                      ? ""
                                      : paisaToRupeeInput(reading.amountPaisa),
                                })
                              }
                              className="h-9 rounded-lg border px-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground active:scale-95"
                            >
                              Exact
                            </button>
                            {row.tenderedText !== "" && (
                              <button
                                type="button"
                                data-testid="denom-clear"
                                onClick={() => updateRow(row.id, { tenderedText: "" })}
                                className="h-9 rounded-lg px-2 text-xs text-muted-foreground underline hover:text-foreground"
                              >
                                Clear
                              </button>
                            )}
                          </div>

                          {reading.tenderedInvalid && (
                            <p
                              data-testid="tendered-invalid-message"
                              aria-live="polite"
                              className="text-xs text-destructive"
                            >
                              Enter what the guest handed over, in rupees.
                            </p>
                          )}
                          {reading.shortPaisa > 0 && (
                            <p
                              data-testid="tender-short-message"
                              aria-live="polite"
                              className="text-xs text-destructive"
                            >
                              {/* Same as the tip line: a JSX child, so the element fits. The
                                  `aria-live` announcement still reads the whole sentence. */}
                              Tendered is <MoneyDisplay paisa={reading.shortPaisa} /> short of the
                              amount.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                data-testid="add-tender-button"
                onClick={addRow}
                className="self-start text-sm text-primary underline"
              >
                + Add tender
              </button>

              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Tender total</span>
                <span data-testid="tender-total-value" data-paisa={tenderTotalPaisa}>
                  <MoneyDisplay paisa={tenderTotalPaisa} className="font-semibold" />
                </span>
              </div>
              {tipTotalPaisa > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tip (not part of the bill)</span>
                  <span data-testid="tip-total-value" data-paisa={tipTotalPaisa}>
                    <MoneyDisplay paisa={tipTotalPaisa} className="font-semibold" />
                  </span>
                </div>
              )}
              {changeDueTotalPaisa > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Change due</span>
                  <span data-testid="change-due-total" data-paisa={changeDueTotalPaisa}>
                    <MoneyDisplay
                      paisa={changeDueTotalPaisa}
                      className="font-semibold text-success"
                    />
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Balance after this tender</span>
                <span
                  data-testid="balance-after-tender-value"
                  data-paisa={Math.max(0, remainingPaisa - tenderTotalPaisa)}
                >
                  <MoneyDisplay
                    paisa={Math.max(0, remainingPaisa - tenderTotalPaisa)}
                    className={cn(
                      "font-semibold",
                      remainingPaisa - tenderTotalPaisa > 0 ? "text-destructive" : "text-success",
                    )}
                  />
                </span>
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
                  "bg-primary-solid text-primary-solid-foreground enabled:hover:bg-primary-solid/90 enabled:active:scale-[0.98]",
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

"use client";

import { useState } from "react";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useVoidOrder, useRefundOrder, useOrderPayments } from "@/lib/hooks/pos/use-payments";
import type { Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

/*
 * F13 — the ONE place this permission code is written down in this file.
 *
 * The notice below tells the reader who can refund, and the guard below decides whether the
 * Refund button is rendered. When those two read different codes they drift, and the drift is
 * silent: the screen goes back to instructing a cashier to press a button they cannot see. One
 * constant, consumed by both, is what makes the copy structurally unable to lie.
 */
const REFUND_PERMISSION = "pos.order.refund";

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

  /*
   * S0-01 — the two triggers are decided by MONEY, not by status alone.
   *
   * They used to be pure status checks (`canVoidOwn = OPEN || SENT_TO_KDS`,
   * `canRefund = CLOSED`) despite being named as though a permission were involved. An order
   * only becomes CLOSED once it is fully Paid AND fully Served, so the ordinary settled check —
   * cash taken, food still on the pass, status SENT_TO_KDS — showed Void and hid Refund. Three
   * clicks then deleted the order from every screen while its payment row survived.
   *
   * `amountPaidPaisa` is the server's own history summed, and refunds come back as NEGATIVE
   * rows, so a fully-reversed order nets to zero and reads correctly as "nothing held" without
   * this component knowing anything about refund records.
   */
  const { data: payments = [], isLoading: paymentsLoading } = useOrderPayments(order.id);
  const amountPaidPaisa = payments.reduce((acc, p) => acc + p.amountPaisa, 0);
  const hasMoneyOnIt = amountPaidPaisa > 0;

  // Unchanged status set — a void is still only offered on a live, un-settled ticket. What is
  // new is that money on the ticket withdraws it, and the operator is told why.
  const voidableStatus = order.status === "OPEN" || order.status === "SENT_TO_KDS";
  const canVoidOwn = voidableStatus && !hasMoneyOnIt && !paymentsLoading;
  // Refund wherever money was actually taken and the order has not already been settled away.
  // Deliberately NOT `status === "CLOSED"`: that is the gate that made this unreachable.
  const canRefund = hasMoneyOnIt && order.status !== "VOIDED" && order.status !== "REFUNDED";
  // The explanatory line that replaces the Void button on a paid ticket. Without it the trigger
  // would simply be missing and the operator would be left guessing.
  const showPaidInsteadOfVoid = voidableStatus && hasMoneyOnIt;

  /*
   * F13 — the notice has to know who is reading it.
   *
   * It used to say "Paid — void unavailable. Use Refund." to everyone, while the Refund button
   * sat behind `pos.order.refund`, which a cashier does not hold. Driven in Chromium on
   * ORD-20260812-0221: the cashier read that sentence with `refundTrigger: false` — an
   * instruction to press a control that is not on the screen, and no hint that this is a job
   * for someone else. The manager, same check, read the same sentence WITH the button.
   *
   * The permission is not widened: a refund moves money out of the drawer and stays a manager's
   * decision. What changes is that the sentence stops pretending otherwise and names who can.
   */
  const { permissions } = useCurrentUser();
  const readerCanRefund = permissions.includes(REFUND_PERMISSION);
  // A second case the old copy left blank rather than wrong: a settled check (CLOSED, so no
  // void was ever on offer) still holds money, and a cashier looking at it got an empty action
  // row — no button, no sentence, nothing to tell them a refund exists or who does it.
  const showRefundNeedsManager = canRefund && !readerCanRefund;
  const paidNotice = showPaidInsteadOfVoid
    ? readerCanRefund
      ? "Paid — void unavailable. Use Refund."
      : "Paid — void unavailable. A manager must refund this check."
    : showRefundNeedsManager
      ? "Paid — a manager must refund this check."
      : null;

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
    /*
     * F13-B — the refusal is DISPLAYED, so it must not also ESCAPE.
     *
     * `mutateAsync` rejects on a 409, and the caller is `onClick={() => void handleVoid()}` —
     * `void` marks the promise as deliberately un-awaited, it does not handle a rejection. So
     * every refused void threw an ApiError out to `window.onunhandledrejection` on top of
     * rendering it, which is what puts the Next dev overlay's error badge on the 409 screenshot.
     * `voidMutation.error` already carries it to the `void-error` paragraph below; the escape
     * added nothing and made this path untestable — a Vitest run whose assertions all pass still
     * exits 1 on the stray rejection, and a permanently-red gate is a gate someone deletes.
     *
     * Behaviour is otherwise unchanged: on failure the panel stays open with the message, exactly
     * as when the throw propagated. (`handleRefund` below still leaks the same way — reported, not
     * fixed here: it needs its own reproduction and its own test.)
     */
    try {
      await voidMutation.mutateAsync({ payload: { reason: voidReason }, idempotencyKey });
    } catch {
      return;
    }
    closePanel();
    onDone?.();
  };

  const handleRefund = async () => {
    if (!refundReason.trim()) return;
    // A FULL refund reverses what was TAKEN, not what was billed. Sending `order.totalPaisa`
    // made a legitimate full reversal of a partly-settled check fail the server's cap.
    const refundPaisa =
      refundScope === "FULL"
        ? amountPaidPaisa
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

  const hasAnyAction = canVoidOwn || canRefund || paidNotice !== null;

  if (!hasAnyAction) return null;

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
              className={cn(
                "font-heading text-base font-semibold",
                mode === "void" && "text-destructive",
              )}
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
              This will cancel order <strong>#{order.orderNo ?? order.id.slice(0, 8)}</strong>. This
              action cannot be undone.
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
              <p data-testid="void-error" className="text-xs text-destructive">
                {voidMutation.error?.status === 403
                  ? "You don't have permission to void this order."
                  : voidMutation.error?.status === 409
                    ? // S0-01: the server refuses a void once money is on the order. Say so
                      // exactly, and name the operation that does work — a generic "try again"
                      // would invite the operator to keep hammering a button that cannot succeed.
                      //
                      // F13-B: and name it to the RIGHT reader. This branch kept the one sentence
                      // F13 was raised about ("use Refund") for everyone, 110 lines below the
                      // notice that was fixed. It is reached without contrivance: the cashier
                      // opens an unpaid fired check — Void genuinely on offer — the money is
                      // taken elsewhere, their tab never reloads, they press Void, 409. Driven in
                      // Chromium on ORD-20260812-0412: `refundTrigger: false` on that screen.
                      //
                      // While this panel is open it REPLACES the trigger row, so the Refund
                      // button is not beside this sentence for ANY reader. What the wording can
                      // honestly turn on is therefore not what is visible but what the reader is
                      // able to do at all — `readerCanRefund`, the same REFUND_PERMISSION check
                      // the notice uses. The permission itself is not widened.
                      readerCanRefund
                      ? "This order has been paid — use Refund. A void would leave the payment in place."
                      : "This order has been paid — a manager must refund this check. A void would leave the payment in place."
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

            <p className="text-sm text-muted-foreground">
              Collected on this order:{" "}
              <MoneyDisplay
                paisa={amountPaidPaisa}
                className="font-medium text-foreground"
                data-testid="refundable-amount"
              />
              . A full refund reverses every tender recorded against it.
            </p>

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
                  "bg-warning text-warning-foreground hover:bg-warning/90",
                )}
              >
                {refundMutation.isPending ? "Processing…" : "Confirm Refund"}
              </button>
            </div>
            {refundMutation.isError && (
              <p data-testid="refund-error" className="text-xs text-destructive">
                Failed to refund. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PermissionGuard require={["pos.order.void.own", "pos.order.void.any"]} mode="any">
        {canVoidOwn && (
          <button
            onClick={() => {
              setMode("void");
              setOpen(true);
            }}
            aria-label="Void order"
            className="text-xs px-3 py-1 rounded border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
          >
            Void
          </button>
        )}
      </PermissionGuard>

      {/*
        S0-01: an absent control with no explanation is how the operator ends up hunting for a
        way to cancel and finding a destructive one. Say the reason, in place, where the Void
        button was. Still not permission-guarded — it states a fact about the ORDER, and hiding
        it from someone without void rights would only make the missing button more mysterious.

        F13: what it SAYS is now chosen by what the reader can actually do, so the sentence and
        the controls beside it always describe the same screen.
      */}
      {paidNotice && (
        <span
          data-testid="void-blocked-paid-notice"
          data-reader-can-refund={readerCanRefund ? "true" : "false"}
          className="text-xs text-muted-foreground"
        >
          {paidNotice}
        </span>
      )}

      <PermissionGuard require={REFUND_PERMISSION}>
        {canRefund && (
          <button
            onClick={() => {
              setMode("refund");
              setOpen(true);
            }}
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

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

  /*
   * B2 re-open — THE PASS, mirrored from pos.rego so the button cannot lie.
   *
   * `pos.rego`'s void.own now refuses a check the kitchen has plated: from the moment a line
   * reaches READY, cooked food exists and writing it off is void.any's business. Without this
   * clause the trigger below would render on a plated check (status is still SENT_TO_KDS —
   * order.status has not tracked kitchen progress since fc6f389f, and no status in the enum
   * distinguishes plated from fired), the cashier would type a reason, press Confirm, and be
   * answered 403 "Not permitted: pos.void".
   *
   * That is not a hypothetical. It is the ORIGINAL B2 defect, verbatim — a Void button that
   * rendered on permission alone and failed at the server — and re-creating it one status later
   * while fixing it here would be the same bug wearing a different hat.
   *
   * The predicate is the client's copy of OrderStatusDerivationService.anyLinePlated, and the
   * two must agree. It reads the same READY/SERVED pair; a CANCELLED line matches neither, which
   * is the server's "cancelled lines are excluded" rule arriving at the same answer by the same
   * route. This is a rendering decision only — the policy is still the authority, and a client
   * that got it wrong would be corrected by a 403 rather than allowed anything.
   */
  const anyLinePlated = order.items.some(
    (i) => i.itemStatus === "READY" || i.itemStatus === "SERVED",
  );

  const canVoidOwn = voidableStatus && !hasMoneyOnIt && !anyLinePlated && !paymentsLoading;
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

  /*
   * The sentence that replaces the Void button once the kitchen has plated. Money outranks it:
   * a check that is BOTH paid and plated reads the paid copy, because refund is the action that
   * actually moves the money and is therefore the one worth naming.
   *
   * It names the manager for the same reason F13's copy does. "Not permitted" tells a cashier
   * they did something wrong; this tells them whose job it is, which is the only thing they can
   * act on at the till. No permission is widened — void.any was always the manager's, and this
   * check was never legitimately the cashier's to write off. What changes is that the screen
   * stops offering it and then refusing.
   */
  const platedNotice =
    voidableStatus && !hasMoneyOnIt && anyLinePlated
      ? "Food has been plated — a manager must void this check."
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
    await voidMutation.mutateAsync({ payload: { reason: voidReason }, idempotencyKey });
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

  const hasAnyAction = canVoidOwn || canRefund || paidNotice !== null || platedNotice !== null;

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
                      "This order has been paid — use Refund. A void would leave the payment in place."
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

      {/*
        B2 re-open: the same treatment for the kitchen boundary. Its own testid rather than a
        reuse of the paid one — they are different facts about the check, they lead to different
        people (refund is the manager's money action, this is the manager's void), and a suite
        that cannot tell them apart would pass while the screen named the wrong remedy.
      */}
      {platedNotice && (
        <span
          data-testid="void-blocked-plated-notice"
          className="text-xs text-muted-foreground"
        >
          {platedNotice}
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

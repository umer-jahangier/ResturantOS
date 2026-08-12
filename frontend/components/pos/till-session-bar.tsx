"use client";

import { useState } from "react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useOpenTill, useCloseTill, useTillReconciliation } from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TillSessionBarProps {
  activeTill: TillSession | null | undefined;
  /**
   * The till READ failed — as opposed to resolving to "no open till" (S1-09).
   *
   * <p>`activeTill` is `undefined` in both cases, which is exactly why this has to be a separate
   * prop: without it the bar rendered the amber "No active till / Open Till" strip while
   * pos-service was stopped, telling a cashier their drawer was closed and offering them a button
   * that could only fail. Photographed on 2026-08-12 above a correct outage alert — the page
   * saying two contradictory things at once.
   */
  readFailed?: boolean;
}

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

/**
 * Neither open-till nor close-till surfaced ANY feedback on mutation failure prior to
 * this fix — the modal just sat there silently (found via 07.1-06 E2E verification
 * against a circuit-broken gateway route). Mirrors PaymentPanel's
 * `getChargeErrorMessage` duck-typed shape (never imports the ApiError class itself,
 * per the FE-08 components boundary) and VoidRefundDialog's inline
 * `text-destructive` banner styling.
 */
// Friendly, actionable copy for the known till error codes (now that parseApiError
// decodes Spring's ProblemDetail `title` into a stable code — previously every failure
// fell through to a generic "Please try again", e.g. the close-till 409 the cashier
// couldn't act on). Duck-typed (never imports ApiError) per the FE-08 components boundary.
const TILL_ERROR_COPY: Record<string, string> = {
  TILL_HAS_OPEN_ORDERS:
    "This till still has open orders. Settle, serve, or void them before closing.",
  // NOT "on this device". till_sessions has no device or terminal column at all — the rule is one
  // open till per CASHIER, and the query behind it (findByCashierIdAndStatus) does not filter by
  // branch either. So the case a user actually hits is: their own till is still open at ANOTHER
  // branch, often from a previous day, and this bar cannot see it because its read IS
  // branch-scoped. Saying "this device" sent them looking for a second browser tab that was never
  // the cause. Until the server names the branch and the time (it already names the cashier when
  // opening for somebody else), this is the most that is true.
  TILL_ALREADY_OPEN:
    "You already have a till open — it may be at another branch, or left open from an earlier " +
    "shift. Close that one before opening a new till.",
  TILL_NOT_FOUND: "This till session no longer exists. Refresh and try again.",
  PERIOD_LOCKED: "The accounting period is locked. Contact a manager to reopen it.",
};

function getTillErrorMessage(
  error: { status?: number; message?: string; code?: string } | null | undefined,
  action: "open" | "close",
): string {
  const fallback =
    action === "open"
      ? "Failed to open till. Please try again."
      : "Failed to close till. Please try again.";
  if (!error) return fallback;
  // Known server error codes get specific, actionable guidance.
  const known = error.code ? TILL_ERROR_COPY[error.code] : undefined;
  if (known) return known;
  if (typeof error.status !== "number") {
    // Not a server-shaped error (e.g. the offline-guard's plain Error) — its message
    // is already user-safe copy, not a raw server dump.
    return error.message ?? fallback;
  }
  return fallback;
}

export function TillSessionBar({ activeTill, readFailed = false }: TillSessionBarProps) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [declaredCash, setDeclaredCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  const { branchId } = useCurrentUser();
  const openTillMutation = useOpenTill();
  const closeTillMutation = useCloseTill();
  // Live reconciliation (orders + accumulating cash) for the OPEN till — so the bar shows the
  // cash actually collected instead of 0 until close.
  const {
    data: recon,
    isPending: reconPending,
    refetch: refetchRecon,
  } = useTillReconciliation(
    activeTill && activeTill.status === "OPEN" ? activeTill.id : null,
  );

  const handleOpenTill = async () => {
    const paisa = Math.round(parseFloat(openingFloat || "0") * 100);
    if (paisa < 0) return;
    await openTillMutation.mutateAsync({ branchId, openingFloatPaisa: paisa });
    setShowOpenModal(false);
    setOpeningFloat("");
  };

  /**
   * What the drawer SHOULD hold at this instant.
   *
   * <p>`activeTill.expectedClosingPaisa` is written by `TillServiceImpl.closeTill` — i.e. only
   * DURING the close — so on an OPEN till it is structurally NULL, and reading it alone left the
   * cashier counting blind at the one moment the number matters (walkthrough §3 #1: the panel said
   * only "Opening float: Rs 5,000.00" while the strip one line above already read
   * "Cash: Rs 6,682.60"). The reconciliation endpoint computes the identical expression live —
   * `openingFloat + cash − cash refunds`, character for character the same as closeTill's — and
   * documents `liveExpectedCashPaisa` as always computed. So: the persisted figure once it is
   * frozen, the live one until then.
   */
  const expectedCashPaisa =
    activeTill?.expectedClosingPaisa ?? recon?.liveExpectedCashPaisa ?? null;

  // Validation as the cashier types. An empty box used to submit `parseFloat("0")` — a silent
  // declaration of Rs 0.00 against a full drawer, which posts a shift-sized shortage nobody typed.
  const declaredTrimmed = declaredCash.trim();
  const declaredPaisa =
    declaredTrimmed === "" ? null : Math.round(Number.parseFloat(declaredTrimmed) * 100);
  const declaredError =
    declaredPaisa === null
      ? null
      : !Number.isFinite(declaredPaisa)
        ? "Declared Cash Count must be a number, e.g. 6682.60"
        : declaredPaisa < 0
          ? "Declared Cash Count cannot be negative — enter what you counted in the drawer"
          : null;
  const declaredValid = declaredPaisa !== null && declaredError === null;

  /** Counted − expected. Negative is money missing from the drawer. */
  const previewVariance =
    declaredValid && expectedCashPaisa !== null ? declaredPaisa - expectedCashPaisa : null;
  /*
   * A shortage is money that is GONE, so it is destructive at any size — the cashier is signing
   * for it. An overage is a discrepancy but not a loss, so it warns. Only an exact match is calm.
   * The words "short"/"over"/"Balanced" carry the same signal without relying on colour.
   */
  const varianceTone =
    previewVariance === null || previewVariance === 0
      ? "text-success"
      : previewVariance < 0
        ? "text-destructive"
        : "text-warning";

  const handleCloseTill = async () => {
    if (!activeTill || !declaredValid) return;
    const idempotencyKey = generateKey();
    await closeTillMutation.mutateAsync({
      tillId: activeTill.id,
      payload: { declaredClosingPaisa: declaredPaisa, note: closeNote.trim() || undefined },
      idempotencyKey,
    });
    setShowCloseModal(false);
    setDeclaredCash("");
    setCloseNote("");
  };

  const variance = activeTill?.variancePaisa;
  const variancePositive = variance !== null && variance !== undefined && variance >= 0;
  const varianceThreshold = 50000; // 500 PKR

  /*
   * Checked BEFORE the "no till" branch, the same precedence QueryBoundary enforces everywhere
   * else: a failed read has no trustworthy answer, so "your till is closed" is not a statement
   * that can honestly be made yet. No Open Till button here — it posts to the service that is
   * not answering, and offering it would be the product suggesting a remedy it knows will fail.
   */
  if (readFailed) {
    return (
      <div className="border-b border-destructive/30">
        <div
          role="status"
          data-testid="till-status-unavailable"
          className="flex items-center gap-2 bg-destructive/10 px-3 py-2"
        >
          <span className="text-small font-medium text-destructive">
            Till status unavailable — the till service is not answering
          </span>
        </div>
      </div>
    );
  }

  if (!activeTill || activeTill.status === "CLOSED") {
    return (
      <div className="border-b border-warning/30">
        {!showOpenModal ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/15">
            <span className="text-small text-warning font-medium">
              No active till
            </span>
            <button
              data-testid="open-till-button"
              onClick={() => setShowOpenModal(true)}
              className="ml-auto min-h-11 text-small bg-success text-success-foreground rounded-md px-4 py-2 font-medium hover:opacity-90"
            >
              Open Till
            </button>
          </div>
        ) : (
          /*
           * Dedicated large in-place panel (POS-25/D-10, UI-SPEC §5), mirroring the
           * 07.3-07 charge-page panel pattern — a plain document-flow section (NOT a
           * Radix Dialog / `[role=dialog]` popup, and not the old hand-rolled
           * full-viewport-overlay centered box). Session-scoped: it stays part of
           * TillSessionBar, which renders above the POS tabs on every tab.
           */
          <div
            data-testid="open-till-panel"
            className="flex flex-col gap-4 bg-warning/15 p-4 sm:p-6"
          >
            <h2 className="font-semibold">Open Till Session</h2>
            <p className="text-xs text-muted-foreground">
              Starting a new cashier till session. Record the counted starting float before taking
              any orders.
            </p>
            <label className="text-sm">
              Opening Float (PKR)
              <input
                type="number"
                min={0}
                step="0.01"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                className="mt-1 w-full max-w-xs rounded border px-3 py-2 text-sm"
                placeholder="e.g. 5000.00"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowOpenModal(false)}
                className="text-sm px-4 py-2 rounded border"
              >
                Cancel
              </button>
              <button
                data-testid="open-till-confirm-button"
                onClick={() => void handleOpenTill()}
                disabled={openTillMutation.isPending}
                className="min-h-11 text-pos px-4 py-2 rounded-md bg-success text-success-foreground font-medium hover:opacity-90 disabled:opacity-50"
              >
                {openTillMutation.isPending ? "Opening…" : "Open Till"}
              </button>
            </div>
            {openTillMutation.isError && (
              <p data-testid="open-till-error" className="text-xs text-destructive">
                {getTillErrorMessage(openTillMutation.error, "open")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-success/30">
      {!showCloseModal ? (
        <div className="flex items-center gap-3 px-3 py-2 bg-success/15">
          <span className="text-small font-medium text-success">
            Till OPEN
          </span>
          <span className="text-xs text-muted-foreground">
            Float: <MoneyDisplay paisa={activeTill.openingFloatPaisa} className="text-xs" />
          </span>
          {recon && (
            <>
              <span className="text-xs text-muted-foreground" data-testid="till-live-cash">
                Cash: <MoneyDisplay paisa={recon.liveExpectedCashPaisa} className="text-xs" />
              </span>
              <span className="text-xs text-muted-foreground">
                Orders: <span className="font-medium tabular-nums">{recon.orderCount}</span>
              </span>
            </>
          )}
          {variance !== null && variance !== undefined && (
            <span
              className={cn(
                "text-xs font-medium",
                Math.abs(variance) > varianceThreshold ? "text-destructive" : "text-success",
              )}
            >
              Var: <MoneyDisplay paisa={Math.abs(variance)} className="text-xs" />
              {!variancePositive && " short"}
            </span>
          )}
          <button
            data-testid="close-till-button"
            onClick={() => setShowCloseModal(true)}
            className="ml-auto min-h-11 text-small bg-secondary text-secondary-foreground rounded-md px-4 py-2 font-medium hover:opacity-90"
          >
            Close Till
          </button>
        </div>
      ) : (
        /* Dedicated large in-place panel (POS-25/D-10) — see the open-till panel comment above. */
        <div
          data-testid="close-till-panel"
          className="flex flex-col gap-4 bg-success/15 p-4 sm:p-6"
        >
          <h2 className="font-semibold">Close Till Session</h2>

          {/*
           * The sum the cashier is being asked to check, written out: float + cash taken =
           * expected. The Expected row is ALWAYS rendered — a missing row reads as "there is no
           * such number", which is the lie this panel used to tell.
           */}
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Opening float:</span>
              <MoneyDisplay paisa={activeTill.openingFloatPaisa} />
            </div>
            {recon && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash taken (net of refunds):</span>
                <MoneyDisplay paisa={recon.cashCollectedPaisa} />
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-border/60 pt-1">
              <span className="text-muted-foreground">Expected cash:</span>
              <span data-testid="close-till-expected" className="text-right">
                {expectedCashPaisa !== null ? (
                  <MoneyDisplay paisa={expectedCashPaisa} />
                ) : reconPending ? (
                  <span className="text-muted-foreground">Working it out…</span>
                ) : (
                  <span className="text-destructive">
                    Unavailable — could not read this till&apos;s totals.{" "}
                    <button
                      type="button"
                      data-testid="close-till-expected-retry"
                      onClick={() => void refetchRecon()}
                      className="font-medium underline underline-offset-2"
                    >
                      Try again
                    </button>
                  </span>
                )}
              </span>
            </div>
          </div>

          <label className="text-sm">
            Declared Cash Count (PKR)
            <input
              type="number"
              min={0}
              step="0.01"
              value={declaredCash}
              onChange={(e) => setDeclaredCash(e.target.value)}
              aria-invalid={declaredError !== null}
              aria-describedby={declaredError ? "close-till-declared-error" : undefined}
              className="mt-1 w-full max-w-xs rounded border px-3 py-2 text-sm"
              placeholder="e.g. 12500.00"
            />
          </label>
          {declaredError && (
            <p
              id="close-till-declared-error"
              data-testid="close-till-declared-error"
              className="text-xs text-destructive"
            >
              {declaredError}
            </p>
          )}

          <label className="text-sm">
            Note for manager review (optional)
            <textarea
              data-testid="close-till-note"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              placeholder="e.g. 200 short — customer disputed change on order #1042"
            />
          </label>

          {/* Variance preview — live, before anything is submitted. */}
          {declaredValid && (
            <div className="text-sm" role="status" aria-live="polite">
              {previewVariance === null ? (
                <span data-testid="close-till-variance" className="font-medium text-warning">
                  Variance cannot be checked until the expected cash figure loads.
                </span>
              ) : (
                <>
                  <span className="text-muted-foreground">Variance: </span>
                  <span
                    data-testid="close-till-variance"
                    className={cn("font-medium", varianceTone)}
                  >
                    {previewVariance === 0 ? (
                      "Balanced — your count matches the drawer"
                    ) : (
                      <>
                        <MoneyDisplay paisa={Math.abs(previewVariance)} />{" "}
                        {previewVariance < 0 ? "short" : "over"}
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowCloseModal(false)}
              className="text-sm px-4 py-2 rounded border"
            >
              Cancel
            </button>
            <button
              data-testid="close-till-confirm-button"
              onClick={() => void handleCloseTill()}
              disabled={closeTillMutation.isPending || !declaredValid}
              className="min-h-11 text-pos px-4 py-2 rounded-md bg-secondary text-secondary-foreground font-medium hover:opacity-90 disabled:opacity-50"
            >
              {closeTillMutation.isPending ? "Closing…" : "Close Till"}
            </button>
          </div>
          {closeTillMutation.isError && (
            <p data-testid="close-till-error" className="text-xs text-destructive">
              {getTillErrorMessage(closeTillMutation.error, "close")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

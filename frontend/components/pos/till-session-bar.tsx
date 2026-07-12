"use client";

import { useState } from "react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useOpenTill, useCloseTill, useTillReconciliation } from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TillSessionBarProps {
  activeTill: TillSession | null | undefined;
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
  TILL_ALREADY_OPEN: "You already have an open till on this device.",
  TILL_NOT_FOUND: "This till session no longer exists. Refresh and try again.",
  PERIOD_LOCKED: "The accounting period is locked. Contact a manager to reopen it.",
};

function getTillErrorMessage(
  error: { status?: number; message?: string; code?: string } | null | undefined,
  action: "open" | "close",
): string {
  const fallback = action === "open" ? "Failed to open till. Please try again." : "Failed to close till. Please try again.";
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

export function TillSessionBar({ activeTill }: TillSessionBarProps) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [declaredCash, setDeclaredCash] = useState("");
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  const { branchId } = useCurrentUser();
  const openTillMutation = useOpenTill();
  const closeTillMutation = useCloseTill();
  // Live reconciliation (orders + accumulating cash) for the OPEN till — so the bar shows the
  // cash actually collected instead of 0 until close.
  const { data: recon } = useTillReconciliation(
    activeTill && activeTill.status === "OPEN" ? activeTill.id : null,
  );

  const handleOpenTill = async () => {
    const paisa = Math.round(parseFloat(openingFloat || "0") * 100);
    if (paisa < 0) return;
    await openTillMutation.mutateAsync({ branchId, openingFloatPaisa: paisa });
    setShowOpenModal(false);
    setOpeningFloat("");
  };

  const handleCloseTill = async () => {
    if (!activeTill) return;
    const paisa = Math.round(parseFloat(declaredCash || "0") * 100);
    const idempotencyKey = generateKey();
    await closeTillMutation.mutateAsync({
      tillId: activeTill.id,
      payload: { declaredClosingPaisa: paisa },
      idempotencyKey,
    });
    setShowCloseModal(false);
    setDeclaredCash("");
  };

  const variance = activeTill?.variancePaisa;
  const variancePositive = variance !== null && variance !== undefined && variance >= 0;
  const varianceThreshold = 50000; // 500 PKR

  if (!activeTill || activeTill.status === "CLOSED") {
    return (
      <div className="border-b border-amber-200">
        {!showOpenModal ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50">
            <span className="text-xs text-amber-700 font-medium">No active till</span>
            <button
              data-testid="open-till-button"
              onClick={() => setShowOpenModal(true)}
              className="ml-auto text-xs bg-emerald-600 text-white rounded px-3 py-1 font-medium hover:bg-emerald-700"
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
            className="flex flex-col gap-4 bg-amber-50 p-4 sm:p-6"
          >
            <h2 className="font-semibold">Open Till Session</h2>
            <p className="text-xs text-muted-foreground">
              Starting a new cashier till session. Record the counted starting float before
              taking any orders.
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
                className="text-sm px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
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
    <div className="border-b border-emerald-200">
      {!showCloseModal ? (
        <div className="flex items-center gap-3 px-3 py-2 bg-emerald-50">
          <span className="text-xs font-medium text-emerald-800">Till OPEN</span>
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
                Math.abs(variance) > varianceThreshold
                  ? "text-red-600"
                  : "text-emerald-700"
              )}
            >
              Var: <MoneyDisplay paisa={Math.abs(variance)} className="text-xs" />
              {!variancePositive && " short"}
            </span>
          )}
          <button
            data-testid="close-till-button"
            onClick={() => setShowCloseModal(true)}
            className="ml-auto text-xs bg-slate-600 text-white rounded px-3 py-1 font-medium hover:bg-slate-700"
          >
            Close Till
          </button>
        </div>
      ) : (
        /* Dedicated large in-place panel (POS-25/D-10) — see the open-till panel comment above. */
        <div
          data-testid="close-till-panel"
          className="flex flex-col gap-4 bg-emerald-50 p-4 sm:p-6"
        >
          <h2 className="font-semibold">Close Till Session</h2>

          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Opening float:</span>
              <MoneyDisplay paisa={activeTill.openingFloatPaisa} />
            </div>
            {activeTill.expectedClosingPaisa !== null && activeTill.expectedClosingPaisa !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected cash:</span>
                <MoneyDisplay paisa={activeTill.expectedClosingPaisa} />
              </div>
            )}
          </div>

          <label className="text-sm">
            Declared Cash Count (PKR)
            <input
              type="number"
              min={0}
              step="0.01"
              value={declaredCash}
              onChange={(e) => setDeclaredCash(e.target.value)}
              className="mt-1 w-full max-w-xs rounded border px-3 py-2 text-sm"
              placeholder="e.g. 12500.00"
            />
          </label>

          {/* Variance preview */}
          {activeTill.expectedClosingPaisa !== null && declaredCash && (
            <div className="text-sm">
              <span className="text-muted-foreground">Variance: </span>
              <span
                className={cn(
                  "font-medium",
                  Math.abs(
                    Math.round(parseFloat(declaredCash) * 100) -
                      (activeTill.expectedClosingPaisa ?? 0)
                  ) > varianceThreshold
                    ? "text-red-600"
                    : "text-emerald-600"
                )}
              >
                <MoneyDisplay
                  paisa={Math.abs(
                    Math.round(parseFloat(declaredCash) * 100) -
                      (activeTill.expectedClosingPaisa ?? 0)
                  )}
                />
              </span>
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
              disabled={closeTillMutation.isPending}
              className="text-sm px-4 py-2 rounded bg-slate-600 text-white font-medium hover:bg-slate-700 disabled:opacity-50"
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

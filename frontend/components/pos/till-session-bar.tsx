"use client";

import { useState } from "react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useOpenTill, useCloseTill } from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TillSessionBarProps {
  activeTill: TillSession | null | undefined;
}

function generateKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function TillSessionBar({ activeTill }: TillSessionBarProps) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [declaredCash, setDeclaredCash] = useState("");
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  const { branchId } = useCurrentUser();
  const openTillMutation = useOpenTill();
  const closeTillMutation = useCloseTill();

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
      <>
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
          <span className="text-xs text-amber-700 font-medium">No active till</span>
          <button
            onClick={() => setShowOpenModal(true)}
            className="ml-auto text-xs bg-emerald-600 text-white rounded px-3 py-1 font-medium hover:bg-emerald-700"
          >
            Open Till
          </button>
        </div>

        {showOpenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-background rounded-lg shadow-xl p-6 w-80 flex flex-col gap-4">
              <h2 className="font-semibold">Open Till Session</h2>
              <label className="text-sm">
                Opening Float (PKR)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
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
                  onClick={handleOpenTill}
                  disabled={openTillMutation.isPending}
                  className="text-sm px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {openTillMutation.isPending ? "Opening…" : "Open Till"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2 bg-emerald-50 border-b border-emerald-200">
        <span className="text-xs font-medium text-emerald-800">Till OPEN</span>
        <span className="text-xs text-muted-foreground">
          Float: <MoneyDisplay paisa={activeTill.openingFloatPaisa} className="text-xs" />
        </span>
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
          onClick={() => setShowCloseModal(true)}
          className="ml-auto text-xs bg-slate-600 text-white rounded px-3 py-1 font-medium hover:bg-slate-700"
        >
          Close Till
        </button>
      </div>

      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl p-6 w-96 flex flex-col gap-4">
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
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
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
                onClick={handleCloseTill}
                disabled={closeTillMutation.isPending}
                className="text-sm px-4 py-2 rounded bg-slate-600 text-white font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {closeTillMutation.isPending ? "Closing…" : "Close Till"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

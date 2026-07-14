"use client";

import { useState } from "react";
import { useClosePeriod } from "@/lib/hooks/finance/use-periods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUserFacingError } from "@/lib/api-client/errors";
import type { AccountingPeriod } from "@/lib/models/finance.model";

interface PeriodCloseModalProps {
  period: AccountingPeriod;
  onClose: () => void;
  onSuccess: () => void;
}

function PeriodCloseModal({ period, onClose, onSuccess }: PeriodCloseModalProps) {
  const [totpCode, setTotpCode] = useState("");
  const { mutate: closePeriod, isPending, error, isSuccess } = useClosePeriod();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    closePeriod(
      { id: period.id, totpCode },
      {
        onSuccess: () => {
          onSuccess();
        },
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="period-close-title"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h2 id="period-close-title" className="mb-1 text-lg font-semibold">
          Close Accounting Period
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {period.startDate} – {period.endDate}
        </p>

        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>Warning:</strong> Closing a period locks it permanently. No
          new journal entries can be posted to a locked period.
        </div>

        {isSuccess ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            Period closed successfully.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="totp">6-digit TOTP code</Label>
              <Input
                id="totp"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                pattern="[0-9]{6}"
                className="font-mono tabular-nums tracking-widest text-center text-lg"
                autoComplete="one-time-code"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {formatUserFacingError(error)}
              </p>
            )}

            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={totpCode.length !== 6 || isPending}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {isPending ? "Closing…" : "Close Period"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export { PeriodCloseModal };

"use client";

import { useState } from "react";
import { usePeriods, useProvisionPeriods } from "@/lib/hooks/finance/use-periods";
import { getFiscalYearPeriods } from "@/lib/utils/pakistan-fiscal-year";
import { FiscalYearNav } from "@/components/finance/FiscalYearNav";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ProvisionPeriodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFiscalYear: number;
}

const DEFAULT_PROVISION_ERROR_MESSAGE =
  "Failed to provision periods. Please try again.";

/**
 * Local, layer-boundary-safe error formatter (components/** may not import
 * @/lib/api-client/** directly — see docs/finance-eslint-backlog.md Issue 1).
 * Mirrors the same convention already used by components/pos/charge-summary.tsx's
 * getRecordPaymentErrorMessage: never surface a raw server-shaped message, only
 * an already-user-safe Error#message (e.g. offline-guard errors) or a generic fallback.
 */
function getProvisionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || DEFAULT_PROVISION_ERROR_MESSAGE;
  }
  return DEFAULT_PROVISION_ERROR_MESSAGE;
}

// Calendar-based 12-period preview + confirm dialog (FIN-10). Its OWN fiscal-year
// state (seeded from initialFiscalYear, independently adjustable) lets a user
// preview/provision a different year than the one behind the dialog without
// closing it first. Never toast-based — inline banners only, mirroring
// PeriodCloseModal's exact pattern (sonner's <Toaster/> is not mounted anywhere).
function ProvisionPeriodDialog({
  open,
  onOpenChange,
  initialFiscalYear,
}: ProvisionPeriodDialogProps) {
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear);
  const { data: existingPeriods } = usePeriods(fiscalYear);
  const preview = getFiscalYearPeriods(fiscalYear);
  const existingPeriodNos = new Set((existingPeriods ?? []).map((p) => p.periodNo));

  const {
    mutate: provisionPeriods,
    isPending,
    error,
    isSuccess,
    data: result,
    reset,
  } = useProvisionPeriods();

  function handleFiscalYearChange(year: number) {
    // A stale success/error banner must not persist across a year change.
    reset();
    setFiscalYear(year);
  }

  function handleConfirm() {
    provisionPeriods({ fiscalYear });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision Accounting Periods</DialogTitle>
          <DialogDescription>
            Preview the 12 monthly periods this fiscal year will produce, then
            confirm to open them.
          </DialogDescription>
        </DialogHeader>

        <FiscalYearNav fiscalYear={fiscalYear} onChange={handleFiscalYearChange} />

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {preview.map((period) => {
            const alreadyOpen = existingPeriodNos.has(period.periodNo);
            return (
              <div
                key={period.periodNo}
                className={`rounded-md border p-2 text-center text-xs ${
                  alreadyOpen
                    ? "border-muted bg-muted text-muted-foreground"
                    : "border-border"
                }`}
              >
                <div className="font-medium">P{period.periodNo}</div>
                <div className="text-muted-foreground">{period.monthLabel}</div>
                {alreadyOpen && <div className="mt-1 text-[10px]">Already open</div>}
              </div>
            );
          })}
        </div>

        {isSuccess && result && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {result.periodsSeeded === 0
              ? `FY ${fiscalYear} is already fully provisioned.`
              : `Provisioned ${result.periodsSeeded} period(s)${
                  result.accountsSeeded > 0
                    ? ` and ${result.accountsSeeded} account(s)`
                    : ""
                }.`}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {getProvisionErrorMessage(error)}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {isSuccess ? "Close" : "Cancel"}
          </Button>
          {!isSuccess && (
            <Button type="button" onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Provisioning…" : `Provision FY ${fiscalYear}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ProvisionPeriodDialog };

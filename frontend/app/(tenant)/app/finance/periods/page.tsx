"use client";

import { useState } from "react";
import { usePeriods } from "@/lib/hooks/finance/use-periods";
import { useFinanceSetupStatus } from "@/lib/hooks/finance/use-accounts";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";
import { PeriodStatusChip } from "@/components/finance/PeriodStatusChip";
import { PeriodCloseModal } from "@/components/finance/PeriodCloseModal";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Button } from "@/components/ui/button";
import type { AccountingPeriod } from "@/lib/models/finance.model";

// URL: /app/finance/periods
export default function PeriodsPage() {
  const fiscalYear = currentPakistanFiscalYear();
  const { data: periods, isLoading } = usePeriods(fiscalYear);
  const { data: setupStatus } = useFinanceSetupStatus();
  const [closingPeriod, setClosingPeriod] = useState<AccountingPeriod | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounting Periods</h1>
          <p className="text-sm text-muted-foreground">
            FY {fiscalYear - 1}–{fiscalYear} (Jul – Jun)
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && !periods?.length && (
        <FinanceEmptyState
          title="No periods found"
          description={
            setupStatus?.provisioned
              ? "No periods for the current fiscal year."
              : "System Admin need to run the script to load COA and periods."
          }
        />
      )}

      {periods && periods.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Start Date</th>
                <th className="py-2 pr-4 font-medium">End Date</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Locked By</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className="border-b">
                  <td className="py-3 pr-4 font-medium">
                    Period {period.periodNo}
                  </td>
                  <td className="py-3 pr-4 font-mono tabular-nums text-sm">
                    {period.startDate}
                  </td>
                  <td className="py-3 pr-4 font-mono tabular-nums text-sm">
                    {period.endDate}
                  </td>
                  <td className="py-3 pr-4">
                    <PeriodStatusChip status={period.status} />
                  </td>
                  <td className="py-3 pr-4 text-sm text-muted-foreground">
                    {period.lockedBy ?? "—"}
                  </td>
                  <td className="py-3 text-right">
                    {period.status === "OPEN" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setClosingPeriod(period)}
                      >
                        Close Period
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closingPeriod && (
        <PeriodCloseModal
          period={closingPeriod}
          onClose={() => setClosingPeriod(null)}
          onSuccess={() => setClosingPeriod(null)}
        />
      )}
    </div>
  );
}

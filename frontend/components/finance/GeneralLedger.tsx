"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGlBalances } from "@/lib/hooks/finance/use-gl";
import { usePeriods } from "@/lib/hooks/finance/use-periods";
import { useFinanceSetupStatus } from "@/lib/hooks/finance/use-accounts";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";
import { MoneyDisplay } from "@/components/ui/money-display";
import { FinanceEmptyState } from "./FinanceEmptyState";

function GeneralLedger() {
  const router = useRouter();
  const fiscalYear = currentPakistanFiscalYear();
  const { data: periods, isLoading: periodsLoading } = usePeriods(fiscalYear);
  const { data: setupStatus } = useFinanceSetupStatus();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const activePeriodId =
    selectedPeriodId ||
    periods?.find((p) => p.status === "OPEN")?.id ||
    periods?.[0]?.id ||
    "";

  useEffect(() => {
    if (!selectedPeriodId && activePeriodId) {
      setSelectedPeriodId(activePeriodId);
    }
  }, [activePeriodId, selectedPeriodId]);

  const { data: balances, isLoading, isError } = useGlBalances(activePeriodId);

  if (!periodsLoading && !periods?.length) {
    return (
      <FinanceEmptyState
        title="No accounting periods"
        description={
          setupStatus?.provisioned
            ? "No periods match the current fiscal year."
            : "System Admin need to run the script to load COA and periods."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="periodSelect" className="text-sm font-medium">
          Period
        </label>
        <select
          id="periodSelect"
          value={activePeriodId}
          onChange={(e) => setSelectedPeriodId(e.target.value)}
          className="rounded border border-input bg-background px-3 py-1.5 text-sm"
          disabled={periodsLoading || !periods?.length}
        >
          {periods?.map((p) => (
            <option key={p.id} value={p.id}>
              P{p.periodNo}: {p.startDate} – {p.endDate} ({p.status})
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted" />
          ))}
        </div>
      )}

      {isError && (
        <FinanceEmptyState
          title="Could not load GL balances"
          description="Select a period to view branch-scoped balances."
        />
      )}

      {balances && !isLoading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Account Name</th>
                <th className="w-32 py-2 text-right font-medium">Debit Total</th>
                <th className="w-32 py-2 text-right font-medium">Credit Total</th>
                <th className="w-32 py-2 text-right font-medium">Net Balance</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr
                  key={row.accountCode}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                  onClick={() =>
                    router.push(
                      `/app/finance/accounts/${row.accountCode}?periodId=${activePeriodId}`,
                    )
                  }
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      router.push(
                        `/app/finance/accounts/${row.accountCode}?periodId=${activePeriodId}`,
                      );
                    }
                  }}
                >
                  <td className="py-2 pr-4 font-mono tabular-nums text-sm">
                    {row.accountCode}
                  </td>
                  <td className="py-2 pr-4">{row.accountName}</td>
                  <td className="w-32 py-2 text-right font-mono tabular-nums">
                    <MoneyDisplay paisa={row.debitTotal} />
                  </td>
                  <td className="w-32 py-2 text-right font-mono tabular-nums">
                    <MoneyDisplay paisa={row.creditTotal} />
                  </td>
                  <td
                    className={`w-32 py-2 text-right font-mono tabular-nums font-medium ${
                      row.netBalance < 0 ? "text-destructive" : ""
                    }`}
                  >
                    <MoneyDisplay paisa={Math.abs(row.netBalance)} />
                    {row.netBalance < 0 && " Cr"}
                  </td>
                </tr>
              ))}
              {balances.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    No posted activity for this branch and period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { GeneralLedger };

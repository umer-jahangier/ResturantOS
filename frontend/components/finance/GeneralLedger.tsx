"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useGlBalances } from "@/lib/hooks/finance/use-gl";
import { usePeriods } from "@/lib/hooks/finance/use-periods";
import { useFinanceSetupStatus } from "@/lib/hooks/finance/use-accounts";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";
import { MoneyDisplay } from "@/components/ui/money-display";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceEmptyState } from "./FinanceEmptyState";
import type { GlBalance } from "@/lib/models/finance.model";

/**
 * Account balances for one period (38-08 task 1).
 *
 * <h3>`Cr` is a word, and it stays a word</h3>
 *
 * A credit balance renders as the magnitude plus the letters `Cr` — which is how an accountant
 * reads it, and not something to "modernise" into a minus. What changed is that the red tint is
 * no longer the only other channel: the marker is inside the cell's text, so it survives
 * greyscale and reaches a screen reader.
 */
function GeneralLedger() {
  const router = useRouter();
  const fiscalYear = currentPakistanFiscalYear();
  const { data: periods, isLoading: periodsLoading } = usePeriods(fiscalYear);
  const { data: setupStatus } = useFinanceSetupStatus();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  // `selectedPeriodId` holds the user's explicit choice only; until they make one the
  // active period is DERIVED from the loaded list. The effect that used to copy this
  // derived value back into state was pure redundancy — every read below already goes
  // through `activePeriodId`, so the copy changed nothing except costing an extra render.
  const activePeriodId =
    selectedPeriodId || periods?.find((p) => p.status === "OPEN")?.id || periods?.[0]?.id || "";

  const { data: balances, isLoading, isError } = useGlBalances(activePeriodId);

  const columns = useMemo<ColumnDef<GlBalance, unknown>[]>(
    () => [
      {
        id: "accountCode",
        accessorKey: "accountCode",
        header: "Code",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() =>
              router.push(
                `/app/finance/accounts/${row.original.accountCode}?periodId=${activePeriodId}`,
              )
            }
            className="font-mono tabular-nums text-primary underline-offset-2 hover:underline"
          >
            {row.original.accountCode}
          </button>
        ),
      },
      { id: "accountName", accessorKey: "accountName", header: "Account name" },
      {
        id: "debitTotal",
        accessorKey: "debitTotal",
        header: "Debit total",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.debitTotal} />
          </span>
        ),
      },
      {
        id: "creditTotal",
        accessorKey: "creditTotal",
        header: "Credit total",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.creditTotal} />
          </span>
        ),
      },
      {
        id: "netBalance",
        accessorKey: "netBalance",
        header: "Net balance",
        cell: ({ row }) => {
          const credit = row.original.netBalance < 0;
          return (
            <span className={`block text-right font-medium ${credit ? "text-destructive" : ""}`}>
              <MoneyDisplay paisa={Math.abs(row.original.netBalance)} />
              {credit ? " Cr" : ""}
            </span>
          );
        },
      },
    ],
    [router, activePeriodId],
  );

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
    <div className="space-y-(--space-md)">
      <FilterBar
        title="Account balances"
        filters={[
          {
            id: "period",
            label: "Period",
            value: activePeriodId,
            onChange: setSelectedPeriodId,
            // Not "All periods". A ledger with no period is not a thing, so the reset entry is
            // labelled as what it actually does — hand the choice back to the derivation above,
            // which lands on the open period.
            allLabel: "Open period",
            isLoading: periodsLoading,
            options: (periods ?? []).map((p) => ({
              value: p.id,
              label: `P${p.periodNo}: ${p.startDate} – ${p.endDate} (${p.status})`,
            })),
          },
        ]}
      />

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
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
        <DataGrid
          label="General ledger balances"
          columns={columns}
          data={balances}
          pageSize={50}
          emptyTitle="No posted activity"
          emptyDescription="Nothing has been posted to this branch and period. That is a real answer, and it is not the same as a failed read."
          card={{
            primary: (b) => b.accountName,
            secondary: (b) => b.accountCode,
            trailing: (b) => (
              <>
                <MoneyDisplay paisa={Math.abs(b.netBalance)} />
                {b.netBalance < 0 ? " Cr" : ""}
              </>
            ),
          }}
        />
      )}
    </div>
  );
}

export { GeneralLedger };

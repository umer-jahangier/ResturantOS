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
import { QueryErrorNotice } from "@/components/ui/query-boundary";
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
  const {
    data: periods,
    isLoading: periodsLoading,
    isError: periodsFailed,
    error: periodsError,
    isFetching: periodsFetching,
    refetch: refetchPeriods,
  } = usePeriods(fiscalYear);
  const { data: setupStatus } = useFinanceSetupStatus();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  // `selectedPeriodId` holds the user's explicit choice only; until they make one the
  // active period is DERIVED from the loaded list. The effect that used to copy this
  // derived value back into state was pure redundancy — every read below already goes
  // through `activePeriodId`, so the copy changed nothing except costing an extra render.
  const activePeriodId =
    selectedPeriodId || periods?.find((p) => p.status === "OPEN")?.id || periods?.[0]?.id || "";

  const {
    data: balances,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useGlBalances(activePeriodId);

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

  /*
   * Before the empty branch, and this one mattered twice over (GA-001).
   *
   * <p>A failed `usePeriods` left `periods` undefined, `!periods?.length` true, and the screen
   * rendered *"No accounting periods — System Admin need to run the script to load COA and
   * periods."* That is not merely wrong, it is an INSTRUCTION: it sends an accountant to ask an
   * administrator to re-provision a chart of accounts that already exists, during an outage, on
   * a tenant whose books are fine.
   */
  if (periodsFailed) {
    return (
      <QueryErrorNotice
        what="the accounting periods"
        moduleLabel="Finance"
        error={periodsError}
        isRetrying={periodsFetching}
        onRetry={() => void refetchPeriods()}
      />
    );
  }

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

      {/*
       * The LAST surviving GA-001 leak in the product, found by scanning for an empty-state
       * component rendered on an `isError` condition (plan 38-12, task 1).
       *
       * <p>It rendered `FinanceEmptyState` — no `role="alert"`, no destructive ramp, the same
       * neutral disc a genuinely-empty ledger draws — and its description read *"Select a period
       * to view branch-scoped balances."* That is worse than silence: it names the reader's own
       * input as the thing to change, so an accountant whose finance-service was down would work
       * the period picker while the figures stayed missing, and would eventually conclude the
       * branch had posted nothing. On a ledger, "nothing posted" is a statement someone closes a
       * month against.
       *
       * <p>`QueryErrorNotice` is the shared surface: it tells a 403 from a 503 from a parse
       * failure, announces itself, carries the retry, and is measured against the empty state's
       * chroma by `state-character.test.tsx`. Nothing here is bespoke.
       */}
      {isError && (
        <QueryErrorNotice
          what="the general ledger"
          moduleLabel="Finance"
          error={error}
          isRetrying={isFetching}
          onRetry={() => void refetch()}
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

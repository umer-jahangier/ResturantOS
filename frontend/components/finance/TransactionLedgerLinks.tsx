"use client";

import { useMemo } from "react";

import { useOrderJournalEntries } from "@/lib/hooks/finance/use-transactions";
import { DrCrAmount } from "@/components/finance/DrCrAmount";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import type { JournalEntryLine, LinkedJournalEntry } from "@/lib/models/transaction.model";

/**
 * The round trip D-37-01 demands: from a transaction row through to the journal entries that
 * transaction's order produced (37-04 + 37-11).
 *
 * <p>Loaded ON DEMAND, per row, when the owner expands it — never eagerly for the page. The
 * register renders up to 200 rows and an eager fetch would be 200 calls to decorate a table
 * nobody has asked a question of yet.
 */
export function TransactionLedgerLinks({ orderId }: { orderId: string }) {
  // Fetched only once the row is expanded — the parent passes the id only then.
  const { data: entries, isLoading, error } = useOrderJournalEntries(orderId);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (error) {
    // D-37-05: say what went wrong. Never render an empty ledger panel that reads as
    // "this order produced no entries" when the truth is "we could not ask".
    return (
      <p className="text-small text-destructive">
        Could not load the accounting entries —{" "}
        {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  if (entries && entries.length === 0) {
    // A true and useful answer, and distinct from a failure. 37-04 returns 200 + [] here.
    return (
      <p className="text-small text-foreground-secondary">
        This order produced no accounting entries.
      </p>
    );
  }

  return (
    <div className="space-y-(--space-md)">
      {entries?.map((entry) => (
        <LedgerEntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function LedgerEntryCard({ entry }: { entry: LinkedJournalEntry }) {
  const columns = useMemo<ColumnDef<JournalEntryLine, unknown>[]>(
    () => [
      {
        id: "accountCode",
        accessorKey: "accountCode",
        header: "Account",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.accountCode}</span>
        ),
      },
      {
        id: "description",
        accessorKey: "description",
        header: "Detail",
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.description ?? "—"}</span>
        ),
      },
      {
        id: "debit",
        accessorKey: "debitPaisa",
        header: "Debit",
        cell: ({ row }) => <DrCrAmount paisa={row.original.debitPaisa} />,
      },
      {
        id: "credit",
        accessorKey: "creditPaisa",
        header: "Credit",
        cell: ({ row }) => <DrCrAmount paisa={row.original.creditPaisa} />,
      },
    ],
    [],
  );

  // Stated, not assumed. The JE_UNBALANCED trigger should make an unbalanced entry impossible —
  // which is exactly why an owner should be told if one ever is. The two sums exist ONLY to be
  // compared against each other and to be printed side by side when they disagree; neither is
  // ever presented as the entry's value.
  const debits = entry.lines.reduce((s, l) => s + l.debitPaisa, 0);
  const credits = entry.lines.reduce((s, l) => s + l.creditPaisa, 0);
  const balanced = debits === credits;

  return (
    <section
      aria-label={`Journal entry ${entry.entryNo}`}
      className="rounded-lg border border-border p-(--space-md)"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium">
          {entry.entryNo} · {entry.sourceType ?? "manual"}
        </span>
        <span className="text-small text-foreground-secondary">{entry.entryDate}</span>
      </div>
      <p className="text-small text-foreground-secondary">{entry.description}</p>

      <div className="mt-(--space-sm)">
        <DataGrid
          label={`Lines of ${entry.entryNo}`}
          columns={columns}
          data={entry.lines}
          density="compact"
          emptyTitle="This entry has no lines"
          card={{
            primary: (l) => l.accountCode,
            secondary: (l) => l.description ?? "—",
            trailing: (l) =>
              l.debitPaisa !== 0 ? (
                <>
                  Dr <MoneyDisplay paisa={l.debitPaisa} />
                </>
              ) : (
                <>
                  Cr <MoneyDisplay paisa={l.creditPaisa} />
                </>
              ),
          }}
        />
      </div>

      <p
        className={
          balanced
            ? "mt-1 text-small text-foreground-secondary"
            : "mt-1 text-small font-medium text-destructive"
        }
      >
        {balanced ? (
          <>
            Balanced · <MoneyDisplay paisa={debits} />
          </>
        ) : (
          <>
            UNBALANCED — debits <MoneyDisplay paisa={debits} /> vs credits{" "}
            <MoneyDisplay paisa={credits} />
          </>
        )}
      </p>
    </section>
  );
}

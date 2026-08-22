"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";

import { formatUserFacingError } from "@/lib/errors";
import { useJournalEntry, usePostJe, useReverseJe } from "@/lib/hooks/finance/use-journal-entries";
import { DrCrAmount } from "@/components/finance/DrCrAmount";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import type { JournalLine } from "@/lib/models/finance.model";

interface JeDetailPageProps {
  params: Promise<{ id: string }>;
}

// URL: /app/finance/journal-entries/[id]
export default function JeDetailPage({ params }: JeDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const jeQuery = useJournalEntry(id);
  const { data: je, isLoading } = jeQuery;
  const { mutate: postJe, isPending: isPosting, error: postError } = usePostJe();
  const { mutate: reverseJe, isPending: isReversing, error: reverseError } = useReverseJe();

  const columns = useMemo<ColumnDef<JournalLine, unknown>[]>(
    () => [
      {
        id: "accountCode",
        accessorKey: "accountCode",
        header: "Account",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.accountCode}</span>
        ),
      },
      { id: "description", accessorKey: "description", header: "Description" },
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

  if (isLoading) {
    return (
      <PageBody className="space-y-(--space-lg)">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </PageBody>
    );
  }

  // GA-001: `isError || !je` reported "Journal entry not found — this entry may have been
  // deleted", which is an alarming and false thing to tell an accountant about a posted entry
  // when the truth is that finance-service returned a 503.
  if (jeQuery.isError) {
    return (
      <QueryErrorNotice
        what="this journal entry"
        error={jeQuery.error}
        onRetry={() => void jeQuery.refetch()}
      />
    );
  }

  if (!je) {
    return (
      <FinanceEmptyState
        title="Journal entry not found"
        description="This entry may have been deleted or you may not have access."
      />
    );
  }

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title={je.entryNo ?? "Draft Entry"}
        description={`${je.entryDate} · ${je.description}`}
        actions={
          <>
            {je.status === "DRAFT" && (
              <Button onClick={() => postJe(id)} disabled={isPosting}>
                {isPosting ? "Posting…" : "Post"}
              </Button>
            )}
            {je.status === "POSTED" && (
              <Button
                variant="outline"
                onClick={() =>
                  reverseJe(id, {
                    onSuccess: (reversed) => {
                      router.push(`/app/finance/journal-entries/${reversed.id}`);
                    },
                  })
                }
                disabled={isReversing}
              >
                {isReversing ? "Reversing…" : "Reverse"}
              </Button>
            )}
          </>
        }
      />

      {(postError || reverseError) && (
        <p className="text-small text-destructive" role="alert">
          {formatUserFacingError(postError ?? reverseError)}
        </p>
      )}

      {/* GA-007: the two totals rendered `paisa.toLocaleString()` — the RAW integer, with no
          conversion and no currency. An entry of Rs 3,886.00 displayed as "388,600" in its own
          header while its line rows, which already went through MoneyDisplay, showed the correct
          figures directly underneath. Every total on this page was 100× too large.
          `lib/adapters/shared.ts:1-2` states the rule this broke: money is integer paisa on the
          wire and is NEVER formatted anywhere but the display layer.

          GA-38-G3: the status used to be `text-emerald-700` / `text-amber-700` — raw palette
          literals, and hue as the only channel. The shared badge carries the word too. */}
      <div className="grid gap-(--space-md) md:grid-cols-3">
        <StatTile
          label="Status"
          value={
            <StatusBadge
              status={je.status === "POSTED" ? "success" : "pending"}
              label={je.status}
            />
          }
        />
        <StatTile label="Total debit" value={<MoneyDisplay paisa={je.totalDebitPaisa} />} />
        <StatTile label="Total credit" value={<MoneyDisplay paisa={je.totalCreditPaisa} />} />
      </div>

      <DataGrid
        label={`Lines of ${je.entryNo ?? "this draft entry"}`}
        columns={columns}
        data={je.lines}
        emptyTitle="This entry has no lines"
        emptyDescription="An entry with no lines cannot be posted. That is the state the server reports, not a failed read."
        card={{
          primary: (line) => line.accountCode,
          secondary: (line) => line.description,
          trailing: (line) =>
            line.debitPaisa !== 0 ? (
              <>
                Dr <MoneyDisplay paisa={line.debitPaisa} />
              </>
            ) : (
              <>
                Cr <MoneyDisplay paisa={line.creditPaisa} />
              </>
            ),
        }}
      />
    </PageBody>
  );
}

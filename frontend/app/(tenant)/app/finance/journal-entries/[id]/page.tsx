"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { formatUserFacingError } from "@/lib/errors";
import { useJournalEntry, usePostJe, useReverseJe } from "@/lib/hooks/finance/use-journal-entries";
import { DrCrCell } from "@/components/finance/DrCrCell";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";

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

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-32 rounded bg-muted" />
      </div>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{je.entryNo ?? "Draft Entry"}</h1>
          <p className="text-sm text-muted-foreground">
            {je.entryDate} · {je.description}
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      {(postError || reverseError) && (
        <p className="text-sm text-destructive" role="alert">
          {formatUserFacingError(postError ?? reverseError)}
        </p>
      )}

      <div className="rounded border p-4 text-sm">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Status</p>
            <p
              className={`mt-0.5 font-medium ${je.status === "POSTED" ? "text-emerald-700" : "text-amber-700"}`}
            >
              {je.status}
            </p>
          </div>
          {/* GA-007: these two rendered `paisa.toLocaleString()` — the RAW integer, with no
              conversion and no currency. An entry of Rs 3,886.00 displayed as "388,600" in its own
              header while its own line rows, which already went through DrCrCell → MoneyDisplay,
              showed the correct figures directly underneath. Every total on this page was 100×
              too large. `lib/adapters/shared.ts:1-2` states the rule this broke: money is integer
              paisa on the wire and must NEVER be formatted anywhere but the display layer. */}
          <div>
            <p className="text-xs uppercase text-muted-foreground">Total Debit</p>
            <p className="mt-0.5 font-mono tabular-nums font-medium">
              <MoneyDisplay paisa={je.totalDebitPaisa} />
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Total Credit</p>
            <p className="mt-0.5 font-mono tabular-nums font-medium">
              <MoneyDisplay paisa={je.totalCreditPaisa} />
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Account</th>
              <th className="py-2 pr-4 font-medium">Description</th>
              <th className="w-32 py-2 text-right font-medium">Debit</th>
              <th className="w-32 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {je.lines.map((line) => (
              <tr key={line.id} className="border-b">
                <td className="py-2 pr-4 font-mono tabular-nums">{line.accountCode}</td>
                <td className="py-2 pr-4">{line.description}</td>
                <DrCrCell paisa={line.debitPaisa} type="debit" />
                <DrCrCell paisa={line.creditPaisa} type="credit" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

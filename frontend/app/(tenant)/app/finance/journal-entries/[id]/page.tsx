"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { formatUserFacingError } from "@/lib/api-client/errors";
import { useJournalEntry, usePostJe, useReverseJe } from "@/lib/hooks/finance/use-journal-entries";
import { DrCrCell } from "@/components/finance/DrCrCell";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Button } from "@/components/ui/button";

interface JeDetailPageProps {
  params: Promise<{ id: string }>;
}

// URL: /app/finance/journal-entries/[id]
export default function JeDetailPage({ params }: JeDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: je, isLoading, isError } = useJournalEntry(id);
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

  if (isError || !je) {
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
          <h1 className="text-2xl font-semibold">
            {je.entryNo ?? "Draft Entry"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {je.entryDate} · {je.description}
          </p>
        </div>
        <div className="flex gap-2">
          {je.status === "DRAFT" && (
            <Button
              onClick={() => postJe(id)}
              disabled={isPosting}
            >
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
          <div>
            <p className="text-xs uppercase text-muted-foreground">Total Debit</p>
            <p className="mt-0.5 font-mono tabular-nums font-medium">
              {je.totalDebitPaisa.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Total Credit</p>
            <p className="mt-0.5 font-mono tabular-nums font-medium">
              {je.totalCreditPaisa.toLocaleString()}
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
                <td className="py-2 pr-4 font-mono tabular-nums">
                  {line.accountCode}
                </td>
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

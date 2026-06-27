"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useJournalEntries } from "@/lib/hooks/finance/use-journal-entries";
import { DrCrCell } from "./DrCrCell";
import { FinanceEmptyState } from "./FinanceEmptyState";
import type { JeFilters } from "@/lib/models/finance.model";

interface JournalEntryTableProps {
  filters?: JeFilters;
}

function JournalEntryTable({ filters }: JournalEntryTableProps) {
  const router = useRouter();
  const { data, isLoading, isError } = useJournalEntries(filters);

  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "Enter") {
      router.push(`/app/finance/journal-entries/${id}`);
    }
    if (e.key === "e" || e.key === "E") {
      // Export stub — Phase 7
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError || !data?.data.length) {
    return (
      <FinanceEmptyState
        title="No journal entries"
        description="Journal entries will appear here once created."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Entry No</th>
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Description</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="w-32 py-2 text-right font-medium">Debit</th>
            <th className="w-32 py-2 text-right font-medium">Credit</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((je) => (
            <tr
              key={je.id}
              tabIndex={0}
              onKeyDown={(e) => handleKeyDown(e, je.id)}
              onClick={() => router.push(`/app/finance/journal-entries/${je.id}`)}
              className="cursor-pointer border-b transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
            >
              <td className="py-2 pr-4 font-mono tabular-nums">
                {je.entryNo ?? "—"}
              </td>
              <td className="py-2 pr-4">{je.entryDate}</td>
              <td className="py-2 pr-4">{je.description}</td>
              <td className="py-2 pr-4">
                <span
                  className={
                    je.status === "POSTED"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }
                >
                  {je.status}
                </span>
              </td>
              <DrCrCell paisa={je.totalDebitPaisa} type="debit" />
              <DrCrCell paisa={je.totalCreditPaisa} type="credit" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { JournalEntryTable };

"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { useJournalEntries } from "@/lib/hooks/finance/use-journal-entries";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { DrCrCell } from "./DrCrCell";
import { FinanceEmptyState } from "./FinanceEmptyState";
import type { JeFilters } from "@/lib/models/finance.model";

interface JournalEntryTableProps {
  filters?: JeFilters;
}

const PAGE_SIZE = 50;

/**
 * The ledger register.
 *
 * <h3>Why there is a search box, and why it is server-side</h3>
 *
 * F10 — every auto-posted row read `Order revenue b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb`. The
 * description now carries the order number the rest of the product uses, which only helps if the
 * row can be reached: the Floating Terrace branch had 254 entries inside the list's default
 * one-month window and the page shows 50. Searching the loaded page in the browser would have
 * found nothing and said so confidently — the same shape as the eleven screens GA-001 fixed. `q`
 * goes to the server, which searches the branch's whole ledger regardless of date.
 *
 * <h3>Why the row count is printed</h3>
 *
 * "Showing 50 of 254" is the difference between a ledger and a sample of one. A truncated list
 * that does not say it is truncated is how the KDS board came to show 20 of 29 tickets.
 */
function JournalEntryTable({ filters }: JournalEntryTableProps) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const debounced = useDebouncedValue(term, 250);

  const entries = useJournalEntries({
    ...filters,
    q: debounced.trim() || undefined,
    page,
    size: PAGE_SIZE,
  });
  const rows = entries.data?.data ?? [];
  const total = entries.data?.meta.totalCount ?? 0;
  const hasNextPage = entries.data?.meta.page.nextCursor != null;
  const searching = debounced.trim().length > 0;

  function changeTerm(next: string) {
    setTerm(next);
    // A filtered result set is a different set: staying on page 3 of the old one shows an empty
    // page and reads as "no matches".
    setPage(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "Enter") {
      router.push(`/app/finance/journal-entries/${id}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={term}
          onChange={(e) => changeTerm(e.target.value)}
          placeholder="Search by entry no or order no, e.g. ORD-20260812-0164"
          aria-label="Search journal entries by entry number or description"
          className="w-full max-w-md"
        />
        {/* Only once the query has actually answered — printing "0 entries" while the first
            request is still in flight states something false for a second. */}
        {entries.data ? (
          <p className="text-sm text-muted-foreground" data-testid="je-result-count">
            {searching
              ? `${total} ${total === 1 ? "entry matches" : "entries match"} “${debounced.trim()}”`
              : `Showing ${rows.length} of ${total} ${total === 1 ? "entry" : "entries"}`}
          </p>
        ) : null}
      </div>

      {/* GA-001, the canonical instance: this was `if (isError || !data?.data.length)` — one
          expression that made a 500 and an empty ledger indistinguishable, on the screen where the
          difference matters most. An accountant told "No journal entries" by a service outage has
          been told their books are empty. */}
      <QueryBoundary
        query={entries}
        what="journal entries"
        isEmpty={rows.length === 0}
        loading={
          <div className="animate-pulse space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        }
        empty={
          searching ? (
            <FinanceEmptyState
              title={`No entry matches “${debounced.trim()}”`}
              description="The search covers every entry for this branch, not just the ones listed — so this really is no match. Check the order number, or try part of it."
            />
          ) : (
            <FinanceEmptyState
              title="No journal entries"
              description="Journal entries will appear here once created."
            />
          )
        }
      >
        <div className="overflow-x-auto">
          {/* `w-full` alone let the table SQUEEZE inside the scroller rather than scroll, and at
              390px the two money columns collided into "Rs 998.00998" — two different figures
              rendered as one number, on a ledger. The min width makes the scroller do its job;
              nothing changes at 768 and above, where the table is narrower than the page. */}
          <table className="w-full min-w-[46rem] text-sm">
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
              {rows.map((je) => (
                <tr
                  key={je.id}
                  tabIndex={0}
                  onKeyDown={(e) => handleKeyDown(e, je.id)}
                  onClick={() => router.push(`/app/finance/journal-entries/${je.id}`)}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                >
                  <td className="py-2 pr-4 font-mono tabular-nums">{je.entryNo ?? "—"}</td>
                  <td className="py-2 pr-4">{je.entryDate}</td>
                  <td className="py-2 pr-4">{je.description}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={je.status === "POSTED" ? "text-emerald-700" : "text-amber-700"}
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
      </QueryBoundary>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export { JournalEntryTable };

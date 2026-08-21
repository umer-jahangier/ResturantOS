"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useJournalEntries } from "@/lib/hooks/finance/use-journal-entries";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { DrCrAmount } from "@/components/finance/DrCrAmount";
import { FinanceEmptyState } from "./FinanceEmptyState";
import type { JeFilters, JournalEntry } from "@/lib/models/finance.model";

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
 *
 * <h3>Why this search box is NOT `FilterBar`'s (38-08 finding)</h3>
 *
 * `FilterBar`'s search field is hard-coded `type="search"`, which maps to the ARIA role
 * `searchbox`, not `textbox`. Six F10 probe scripts and the component suite locate this box as
 * `getByRole("textbox", { name: "Search journal entries by entry number or description" })`. The
 * primitive is right and the role is right; adopting it here would silently unhook every one of
 * those, on the screen whose whole point is that an entry can be FOUND. The strip is worth having
 * and is not worth that, so this screen keeps its own labelled input and the finding is recorded
 * rather than absorbed.
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

  const columns = useMemo<ColumnDef<JournalEntry, unknown>[]>(
    () => [
      {
        id: "entryNo",
        accessorKey: "entryNo",
        header: "Entry no",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => router.push(`/app/finance/journal-entries/${row.original.id}`)}
            className="font-mono tabular-nums text-primary underline-offset-2 hover:underline"
          >
            {row.original.entryNo ?? "—"}
          </button>
        ),
      },
      {
        id: "entryDate",
        accessorKey: "entryDate",
        header: "Date",
        cell: ({ row }) => <span className="tabular-nums">{row.original.entryDate}</span>,
      },
      { id: "description", accessorKey: "description", header: "Description" },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        // GA-38-G3: this was `text-emerald-700` / `text-amber-700` — two raw palette literals
        // that follow neither the theme nor `--brand-h`, on the one column where a reader has to
        // tell a posted entry from a draft. The shared badge carries a token hue AND the word.
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status === "POSTED" ? "success" : "pending"}
            label={row.original.status}
          />
        ),
      },
      {
        id: "debit",
        accessorKey: "totalDebitPaisa",
        header: "Debit",
        cell: ({ row }) => <DrCrAmount paisa={row.original.totalDebitPaisa} />,
      },
      {
        id: "credit",
        accessorKey: "totalCreditPaisa",
        header: "Credit",
        cell: ({ row }) => <DrCrAmount paisa={row.original.totalCreditPaisa} />,
      },
    ],
    [router],
  );

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
          <p className="text-small text-foreground-secondary" data-testid="je-result-count">
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
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
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
        <DataGrid
          label="Journal entries"
          columns={columns}
          data={rows}
          // The SERVER paginates this list, and it has already cut the set to 50. A second,
          // client-side pager over the same 50 would put "Page 1 of 1" beside a Next button that
          // fetches page 2 — two pagers, one of them lying. One page of 50 keeps DataGrid's own
          // controls hidden and leaves the server pager below as the only one.
          pageSize={PAGE_SIZE}
          isFiltered={searching}
          onClearFilters={() => changeTerm("")}
          card={{
            primary: (je) => je.entryNo ?? "—",
            secondary: (je) => `${je.entryDate} · ${je.description}`,
            trailing: (je) => <MoneyDisplay paisa={je.totalDebitPaisa} />,
          }}
        />
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
          <span className="text-small text-foreground-secondary">Page {page + 1}</span>
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

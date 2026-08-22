"use client";

import { useMemo } from "react";

import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { LedgerTotalRow } from "@/components/finance/LedgerTotalRow";
import type { ApAgingBucket } from "@/lib/models/finance.model";

/**
 * The bucket grid both aging reports render (38-08 task 1).
 *
 * <h3>Why the two tables are now one implementation</h3>
 *
 * `ArAgingTable`'s own docblock explained that it was "a thin, near-identical sibling" of
 * `ApAgingTable`, forked because the two DTOs name their total differently (`totalApPaisa` vs
 * `totalArPaisa`) and generics for one caller looked like overkill. That was a fair call when
 * each was twelve lines of `<td>`. It stops being one the moment both need the same grid, the
 * same overdue treatment, the same card fallback and the same escalated total — four things that
 * would now have to stay in step across two files by hand. The differing field is read by the
 * caller and handed in as a number, which costs one prop and removes the fork.
 *
 * <h3>Overdue is not carried by colour</h3>
 *
 * "Over 90" is the whole point of an aging report, and it used to be marked by a tinted row and
 * red text — hue, twice, and nothing else. A reader with deuteranopia, a greyscale print or a
 * screenshot run through a chat client's compression gets none of it. The bucket now carries the
 * WORD "Overdue" in a badge, and the tint stays as reinforcement rather than as the message.
 */
export function AgingGrid({
  buckets,
  totalPaisa,
  totalLabel,
  totalNote,
  label,
}: {
  buckets: ApAgingBucket[];
  /** Stated by the server. Nothing here sums the buckets — see {@link LedgerTotalRow}. */
  totalPaisa: number;
  totalLabel: string;
  totalNote: string;
  /** The grid's accessible name, e.g. "Accounts payable aging". */
  label: string;
}) {
  const columns = useMemo<ColumnDef<ApAgingBucket, unknown>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        header: "Bucket",
        cell: ({ row }) => (
          <span className="flex items-center gap-(--space-sm)">
            <span className="font-medium">{row.original.label}</span>
            {isOverdue(row.original) ? <StatusBadge status="error" label="Overdue" /> : null}
          </span>
        ),
      },
      {
        id: "days",
        header: "Days",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-foreground-secondary">
            {row.original.maxDays >= 999_999
              ? `${row.original.minDays}+ days`
              : `${row.original.minDays}–${row.original.maxDays} days`}
          </span>
        ),
      },
      {
        id: "amount",
        accessorKey: "amountPaisa",
        header: "Amount",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay
              paisa={row.original.amountPaisa}
              className={isOverdue(row.original) ? "text-destructive" : undefined}
            />
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-(--space-md)">
      <DataGrid
        label={label}
        columns={columns}
        data={buckets}
        rowClassName={(bucket) => (isOverdue(bucket) ? "bg-destructive/10" : undefined)}
        emptyTitle="No buckets returned"
        emptyDescription="The service answered with no aging buckets at all, which is different from every bucket being zero."
        card={{
          primary: (b) => b.label,
          secondary: (b) =>
            b.maxDays >= 999_999 ? `${b.minDays}+ days` : `${b.minDays}–${b.maxDays} days`,
          trailing: (b) => <MoneyDisplay paisa={b.amountPaisa} />,
        }}
      />
      <LedgerTotalRow
        label={totalLabel}
        note={totalNote}
        value={<MoneyDisplay paisa={totalPaisa} />}
        data-testid="aging-total"
      />
    </div>
  );
}

/** The server names the bucket; "over" is the word it uses for the tail one. */
function isOverdue(bucket: ApAgingBucket): boolean {
  return bucket.label.toLowerCase().includes("over");
}

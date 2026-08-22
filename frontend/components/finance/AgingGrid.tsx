"use client";

import { useMemo } from "react";

import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { LedgerTotalRow } from "@/components/finance/LedgerTotalRow";
import { Meter } from "@/components/ui/meter";
import type { ApAgingBucket } from "@/lib/models/finance.model";

/**
 * The demo's small-caps eyebrow (`.card-title`, `DEMO-COMPONENTS.md:453`): 11px, 600,
 * letter-spacing .08em, uppercase. It names the SECTION, and it is most of the difference between
 * "a heading" and "a designed screen" — our sentence-case `<h2>`s read as document text.
 */
const SECTION_HEADING =
  "text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary";

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

  const overduePaisa = buckets.reduce((sum, b) => (isOverdue(b) ? sum + b.amountPaisa : sum), 0);

  return (
    /*
     * The demo's universal back-office body: a primary table at 2fr beside a secondary panel at
     * 1fr (DEMO-SCREENS, "the universal two-column body pattern"). The panel is METERS, which is
     * the device the demo uses for AP aging specifically — a bucket's amount means very little
     * on its own and a great deal as a share of what is owed in total.
     *
     * `minmax(0,1fr)` on the BASE track: a grid item defaults to `min-width: auto`, so without it
     * the table refuses to shrink and the page scrolls sideways at 390.
     */
    <div className="grid grid-cols-[minmax(0,1fr)] gap-(--space-lg) xl:grid-cols-[2fr_1fr]">
      <section aria-label={label} className="space-y-(--space-md)">
        <h2 className={SECTION_HEADING}>{totalLabel}</h2>
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
      </section>

      <aside
        aria-label={`${totalLabel} — share of total`}
        data-testid="aging-share-panel"
        className="h-fit space-y-(--space-md) rounded-xl border border-border bg-card p-5 text-card-foreground"
      >
        <h2 className={SECTION_HEADING}>Share of total</h2>
        <div className="space-y-(--space-md)">
          {buckets.map((bucket) => (
            <Meter
              key={bucket.label}
              label={bucket.label}
              value={bucket.amountPaisa}
              of={totalPaisa}
              format="money"
              status={isOverdue(bucket) ? { tone: "danger", label: "Overdue" } : undefined}
            />
          ))}
        </div>
        {/*
         * Stated, not implied. `overduePaisa` is a sum of figures the service returned, so it is
         * computable and gets a number; nothing here is a ratio this screen invented.
         */}
        <LedgerTotalRow
          label="Overdue"
          note="The buckets above whose window has already passed."
          value={<MoneyDisplay paisa={overduePaisa} />}
          data-testid="aging-overdue-total"
        />
      </aside>
    </div>
  );
}

/** The server names the bucket; "over" is the word it uses for the tail one. */
function isOverdue(bucket: ApAgingBucket): boolean {
  return bucket.label.toLowerCase().includes("over");
}

"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";

import type { CardRenderers } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatDateTime, formatNumber } from "@/lib/format/locale";

/**
 * How a dynamic ClickHouse result column is named, typed and drawn — once, for every surface
 * that renders one.
 *
 * <h3>Why this file exists</h3>
 *
 * `ReportTable.tsx` and `components/nlq/NlqResultPanel.tsx` each carried their own private
 * `isMoneyColumn`, `formatLabel` and `renderCell`, byte-identical at birth and already free to
 * drift: NLQ's copy still lacks the em-dash reasoning `ReportTable`'s carries, and neither knew
 * what to do with a `_at` timestamp or a four-digit count. Both read the SAME wire shape —
 * `List<Map<String,Object>>` off ClickHouse, keyed by whatever `columns` names — so there is one
 * set of conventions here and no second place to fix.
 *
 * <h3>The conventions, and where each one comes from</h3>
 *
 * | suffix | meaning | source of the convention |
 * |---|---|---|
 * | `…_paisa` | BIGINT money | `ReportCatalog.java` aliases every money column this way |
 * | `…_at` | an instant | `closed_at` on `till-sessions` and `discount-summary` |
 * | `…_id` / `…_no` | an identifier | a grouped order number (`1,234`) is not an order number |
 * | `hour_of_day` | a 0–23 bucket | `toHour(closed_at)`, `ReportCatalog.java:117` |
 * | anything else numeric | a measure | grouped through the pinned formatter |
 *
 * <h3>A null cell is an ABSENCE and never a zero (D-38-16)</h3>
 *
 * `cogs_paisa` and `gross_margin_paisa` are Phase-8-deferred NULLs on every row, and
 * `ReportCatalog.java:74-80` goes out of its way — `countIf(… IS NOT NULL) = 0 → NULL` — to stop
 * ClickHouse's NULL-skipping `sum()` from answering `0`. A UI that then printed `0` would undo
 * that guard at the last inch and tell an owner they sell at cost. So a null renders `—` with an
 * accessible name that says which column is missing, because an unlabelled em-dash announces as
 * a punctuation mark and nothing else.
 *
 * <h3>Money never gets a second formatter</h3>
 *
 * Every `…_paisa` cell goes through {@link MoneyDisplay}, which is the product's only money path
 * (38-08 task 2). Numbers and dates go through `lib/format/locale.ts`, which is the only pinned
 * locale (G5). Nothing here calls `toFixed`, `toLocaleString` or constructs an `Intl` formatter.
 */

/** Money is any column ending `_paisa` — the ClickHouse alias convention, not a guess. */
export function isMoneyColumn(column: string): boolean {
  return column.endsWith("_paisa");
}

/** An instant is any column ending `_at` — `closed_at` is the only one in the catalog today. */
export function isInstantColumn(column: string): boolean {
  return column.endsWith("_at");
}

/**
 * An identifier is never grouped. `order_no` grouped to `1,234` reads as a quantity, and a
 * cashier looking for order 1234 would not find it.
 */
export function isIdentifierColumn(column: string): boolean {
  return column.endsWith("_id") || column.endsWith("_no");
}

/**
 * `13` → `13:00`.
 *
 * The bucket IS the hour, so writing it as a clock time is a rendering of the same fact and not
 * a claim about minutes. It is written the same way in the grid and in the chart deliberately:
 * a reader comparing the two must not have to decide whether `13` and `13:00` are the same row.
 * 24-hour, because the product's other clock faces are (`kds`, `elapsed.ts`) and `1 PM` beside
 * `13:00` would be a second spelling of one number.
 */
export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** `revenue_paisa` → `Revenue Paisa`. The column name is the only English the wire carries. */
export function formatColumnLabel(column: string): string {
  return column
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ReportCell({ column, value }: { column: string; value: unknown }) {
  if (value === null || value === undefined) {
    // The dash is a placeholder; the accessible name is the information.
    return <span aria-label={`${formatColumnLabel(column)} not available`}>—</span>;
  }
  if (isMoneyColumn(column) && (typeof value === "number" || typeof value === "bigint")) {
    return <MoneyDisplay paisa={value} />;
  }
  if (isInstantColumn(column) && (typeof value === "string" || typeof value === "number")) {
    return <span>{formatDateTime(value)}</span>;
  }
  if (typeof value === "number") {
    if (column === "hour_of_day") return <span>{formatHourLabel(value)}</span>;
    if (isIdentifierColumn(column)) return <span>{String(value)}</span>;
    return <span>{formatNumber(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

/**
 * `columns` → `DataGrid` column definitions.
 *
 * <p>`accessorFn` rather than `accessorKey`: TanStack reads an `accessorKey` as a deep path, so a
 * column whose name contains a dot would silently resolve to `undefined`. Nothing in the catalog
 * has one today, and nothing about the wire shape promises that stays true — the rows are a
 * `Map<String,Object>` and the keys are SQL aliases.
 */
export function reportColumns<TRow extends Record<string, unknown>>(
  columns: readonly string[],
): ColumnDef<TRow, unknown>[] {
  return columns.map((column) => ({
    id: column,
    accessorFn: (row: TRow) => row[column],
    header: formatColumnLabel(column),
    cell: ({ row }) => <ReportCell column={column} value={row.original[column]} />,
  }));
}

/**
 * The below-`md` card face for a report row (UI-SPEC §7, brief §57).
 *
 * <p>A report row is N meaningful columns and a card has three slots, so the mapping is stated
 * rather than guessed: every catalog report puts its DIMENSION first (`business_date`,
 * `hour_of_day`, `order_type`, `menu_item_id`) and its headline MEASURE last (`total_paisa`,
 * `revenue_paisa`, `spend_paisa`), which is the ordering `ReportCatalog.java` writes by hand in
 * every `define(…)` call. So first → `primary`, last → `trailing`, and everything between is
 * spelled out as labelled pairs rather than dropped: on a phone the middle columns are the ones
 * a manager scrolls a desktop table sideways to reach.
 */
export function reportCardRenderers<TRow extends Record<string, unknown>>(
  columns: readonly string[],
): CardRenderers<TRow> {
  const first = columns[0];
  const last = columns.length > 1 ? columns[columns.length - 1] : undefined;
  const middle = columns.slice(1, columns.length - 1);

  return {
    primary: (row) => (first ? <ReportCell column={first} value={row[first]} /> : null),
    secondary: (row) =>
      middle.length === 0 ? null : (
        <span className="flex flex-wrap gap-x-2">
          {middle.map((column) => (
            <span key={column}>
              <span className="text-foreground-tertiary">{formatColumnLabel(column)} </span>
              <ReportCell column={column} value={row[column]} />
            </span>
          ))}
        </span>
      ),
    trailing: (row) => (last ? <ReportCell column={last} value={row[last]} /> : null),
  };
}

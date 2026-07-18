"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
import type { ReportResult } from "@/lib/models/reporting.model";

const NULLABLE_MONEY_COLUMNS = new Set(["cogs_paisa", "gross_margin_paisa"]);

/** Money columns are anything ending `_paisa` (the ClickHouse column-alias convention). */
function isMoneyColumn(column: string): boolean {
  return column.endsWith("_paisa");
}

function formatLabel(column: string): string {
  return column
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * A `null` cell renders as an em-dash — NEVER as 0, never as blank. A user seeing `0` margin
 * would reasonably conclude the business is selling at cost; that is worse than showing nothing.
 */
function renderCell(column: string, value: unknown) {
  if (value === null || value === undefined) {
    return <span aria-label={`${formatLabel(column)} not available`}>—</span>;
  }
  if (isMoneyColumn(column) && (typeof value === "number" || typeof value === "bigint")) {
    return <MoneyDisplay paisa={value} />;
  }
  return <span>{String(value)}</span>;
}

interface ReportTableProps {
  result: ReportResult | undefined;
  isLoading: boolean;
}

export function ReportTable({ result, isLoading }: ReportTableProps) {
  if (isLoading) {
    return (
      <div className="w-full overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-24" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            {Array.from({ length: 5 }).map((_, colIndex) => (
              <Skeleton key={colIndex} className="h-4 w-24" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const hasNullableCogs = result.columns.some((c) => NULLABLE_MONEY_COLUMNS.has(c));

  if (result.rows.length === 0) {
    return (
      <EmptyState
        title="No data for this period"
        description="Try a wider date range or a different branch."
      />
    );
  }

  return (
    <div className="space-y-3">
      {(hasNullableCogs || result.dataNotes.length > 0) && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {result.dataNotes.length > 0
            ? result.dataNotes.join(" ")
            : "COGS and margin require Inventory (Phase 8) and are not yet available."}
        </div>
      )}
      <div className="w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {result.columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {formatLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border last:border-0">
                {result.columns.map((column) => (
                  <td key={column} className="px-4 py-3 tabular-nums">
                    {renderCell(column, row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

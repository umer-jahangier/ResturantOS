"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import type { NlqResult } from "@/lib/models/nlq.model";

/** Money columns are anything ending `_paisa` (the same ClickHouse column-alias convention
 * `ReportTable` uses). */
function isMoneyColumn(column: string): boolean {
  return column.endsWith("_paisa");
}

function formatLabel(column: string): string {
  return column
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderCell(column: string, value: unknown) {
  if (value === null || value === undefined) {
    return <span aria-label={`${formatLabel(column)} not available`}>—</span>;
  }
  if (isMoneyColumn(column) && (typeof value === "number" || typeof value === "bigint")) {
    return <MoneyDisplay paisa={value} />;
  }
  return <span>{String(value)}</span>;
}

interface NlqResultPanelProps {
  result: NlqResult;
}

/**
 * NLQ-01/NLQ-02: the narrative, the result table, a collapsible disclosure of the EXECUTED SQL
 * (deliberately shown — it's post-validation and tenant-scoped, and it's what makes an
 * AI-generated answer trustworthy), a "cached result" badge when `cacheHit`, and a
 * rowCount/durationMs footer.
 */
export function NlqResultPanel({ result }: NlqResultPanelProps) {
  return (
    <div className="space-y-4">
      {result.cacheHit && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
          Cached result
        </span>
      )}

      {result.narrative && <p className="text-sm leading-relaxed">{result.narrative}</p>}

      {result.rows.length === 0 ? (
        <EmptyState
          title="No matching data"
          description="Try being more specific — a date range, a branch, or a shorter time window."
        />
      ) : (
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
      )}

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-muted-foreground">
          Show the SQL that ran
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">
          {result.sql}
        </pre>
      </details>

      <div className="text-xs text-muted-foreground">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.durationMs}ms
      </div>
    </div>
  );
}

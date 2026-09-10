"use client";

import * as React from "react";
import { DatabaseZap } from "lucide-react";

import { DataGrid } from "@/components/ui/data-grid/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { reportCardRenderers, reportColumns } from "@/components/reporting/report-cells";
import { formatNumber } from "@/lib/format/locale";
import type { NlqResult, NlqRow } from "@/lib/models/nlq.model";

/**
 * NLQ-01/NLQ-02: the narrative, the result grid, a disclosure of the EXECUTED SQL, a cache badge
 * and a row/duration footer.
 *
 * <h3>Brought onto the shared grammar (N12)</h3>
 *
 * This screen answered questions with a hand-rolled `<table>` (gate G4) and six off-contract type
 * classes, sitting a click away from `/app/dashboard`. It renders the same wire shape as a
 * report — `columns` plus `List<Map<String,Object>>` off ClickHouse — and it carried its own
 * byte-identical copies of `isMoneyColumn`, `formatLabel` and `renderCell` to prove it. Both now
 * come from `components/reporting/report-cells.tsx`, so a `…_paisa` column renders as money and a
 * null renders as a stated absence in exactly one implementation rather than two that agreed on
 * the day they were written.
 *
 * <h3>The SQL stays visible, deliberately</h3>
 *
 * It is post-validation and tenant-scoped, and it is the only thing that makes an AI-generated
 * answer auditable. It is a `<details>` rather than an always-open block because the answer is
 * what was asked for and the query is the evidence behind it.
 */
export function NlqResultPanel({ result }: { result: NlqResult }) {
  const columns = React.useMemo(() => reportColumns<NlqRow>(result.columns), [result.columns]);
  const card = React.useMemo(() => reportCardRenderers<NlqRow>(result.columns), [result.columns]);

  return (
    <div className="space-y-(--space-md)">
      {result.cacheHit && (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-label font-medium text-foreground-secondary">
          <DatabaseZap className="size-3.5 shrink-0" aria-hidden="true" />
          Cached result — served without re-running the query
        </p>
      )}

      {result.narrative && <p className="text-body leading-relaxed">{result.narrative}</p>}

      {result.rows.length === 0 ? (
        <EmptyState
          title="No matching data"
          description="Try being more specific — a date range, a branch, or a shorter time window."
        />
      ) : (
        <DataGrid columns={columns} data={result.rows} card={card} label="Answer" />
      )}

      <details className="rounded-lg border border-border px-(--space-md) py-(--space-sm)">
        <summary className="cursor-pointer text-small font-medium text-foreground-secondary">
          Show the SQL that ran
        </summary>
        <pre className="relative mt-(--space-sm) overflow-x-auto rounded-md bg-muted p-(--space-md) text-label break-words whitespace-pre-wrap">
          {result.sql}
        </pre>
      </details>

      <p className="text-small text-foreground-tertiary tabular-nums">
        {formatNumber(result.rowCount)} row{result.rowCount === 1 ? "" : "s"} ·{" "}
        {formatNumber(result.durationMs)} ms
      </p>
    </div>
  );
}

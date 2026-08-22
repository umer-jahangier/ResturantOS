"use client";

import * as React from "react";

import { DataGrid } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { ReportDataNotes } from "@/components/reporting/ReportDataNotes";
import { reportCardRenderers, reportColumns } from "@/components/reporting/report-cells";
import type { ReportResult, ReportRow } from "@/lib/models/reporting.model";

/**
 * A report result, as the product's one enterprise grid.
 *
 * <h3>What changed and why</h3>
 *
 * This used to hand-roll a `<table>` — sticky-less headers, no pagination, no row-selection, and
 * a desktop layout dropped unchanged onto a 390px phone. It is now `DataGrid`, which is the
 * single sanctioned table in the product (gate G4), so a report inherits sticky column headers,
 * one row height, 25/50/100 paging with a reconciling row count, and a card list below `md`
 * instead of a sideways scroll. The cell conventions moved to
 * `components/reporting/report-cells.tsx`, which `NlqResultPanel` now shares — the two files used
 * to carry byte-identical private copies of `isMoneyColumn`/`formatLabel`/`renderCell`.
 *
 * <h3>The hardcoded caveat is GONE</h3>
 *
 * The previous version, when a result carried `cogs_paisa`/`gross_margin_paisa` and the server
 * sent no `dataNotes`, supplied its own sentence: *"COGS and margin require Inventory (Phase 8)
 * and are not yet available."* That is a frontend copy of a string the backend owns and is
 * currently revising, and it made the UI assert a REASON it does not know — it knows the column
 * is null, which the em-dash already says honestly. {@link ReportDataNotes} now renders exactly
 * what the API sent and nothing when it sent nothing.
 *
 * <h3>Empty is a state, not a blank</h3>
 *
 * `result === undefined` renders `null` only because the caller — the run page — wraps this in a
 * `QueryBoundary` that owns the error, loading and unknown-code states. That division is
 * deliberate and is what F15 was about: this component genuinely cannot tell a 503 from a report
 * that has not been asked to run, so it is not allowed to draw a conclusion about either.
 */

interface ReportTableProps {
  result: ReportResult | undefined;
  isLoading: boolean;
}

export function ReportTable({ result, isLoading }: ReportTableProps) {
  const columnNames = result?.columns;
  const columns = React.useMemo(() => reportColumns<ReportRow>(columnNames ?? []), [columnNames]);
  const card = React.useMemo(
    () => reportCardRenderers<ReportRow>(columnNames ?? []),
    [columnNames],
  );

  if (isLoading) return <DataTableSkeleton columns={columnNames?.length ?? 5} />;
  if (!result) return null;

  return (
    <div className="space-y-(--space-md)">
      {/* Above the grid, not below it: a caveat a reader meets after they have finished reading
          the numbers is a caveat that arrived too late to change how they read them. */}
      <ReportDataNotes notes={result.dataNotes} />

      <DataGrid
        columns={columns}
        data={result.rows}
        card={card}
        label={result.title}
        emptyTitle="No data for this period"
        emptyDescription="Try a wider date range, or a different branch."
      />
    </div>
  );
}

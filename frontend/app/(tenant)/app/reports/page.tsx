"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { DataGrid } from "@/components/ui/data-grid/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format/locale";
import { useReports } from "@/lib/hooks/reporting/use-reports";
import type { ReportDefinition } from "@/lib/models/reporting.model";

/**
 * The report catalog.
 *
 * <h3>What it was</h3>
 *
 * Category headings over `<ul className="divide-y">` link lists — a fourth spelling of a list in
 * a product that has one grid — with no way to search seven reports and no statement of how many
 * there are. Now: `PageHeader` with a `·`-separated subtitle, `FilterBar` for category and
 * search, `DataGrid` beneath.
 *
 * <h3>The subtitle reconciles with the grid, including while filtered</h3>
 *
 * Both numbers come from the same two arrays. When a filter is on, the subtitle says
 * *"3 of 7 reports"* rather than continuing to claim 7 while the grid shows 3 — a header that
 * disagrees with the table under it is how a reader learns to trust neither.
 */

function ReportsBrowser() {
  // GA-001: `data ?? []` made a reporting-service outage read as "The report catalog is empty."
  const reportsQuery = useReports();
  const reports = React.useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);

  const [category, setCategory] = React.useState("");
  const [search, setSearch] = React.useState("");

  const categories = React.useMemo(
    () =>
      [...new Set(reports.map((r) => r.category))].sort().map((value) => ({ value, label: value })),
    [reports],
  );

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return reports.filter(
      (report) =>
        (category === "" || report.category === category) &&
        (needle === "" ||
          report.title.toLowerCase().includes(needle) ||
          report.code.toLowerCase().includes(needle)),
    );
  }, [reports, category, search]);

  const isFiltered = category !== "" || search.trim() !== "";
  const clearAll = React.useCallback(() => {
    setCategory("");
    setSearch("");
  }, []);

  const columns = React.useMemo<ColumnDef<ReportDefinition, unknown>[]>(
    () => [
      {
        id: "title",
        accessorFn: (row) => row.title,
        header: "Report",
        cell: ({ row }) => (
          <Link
            href={`/app/reports/${row.original.code}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.title}
          </Link>
        ),
      },
      { id: "category", accessorFn: (row) => row.category, header: "Category" },
      {
        id: "columns",
        accessorFn: (row) => row.columns.length,
        header: "Columns",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatNumber(row.original.columns.length)}</span>
        ),
      },
    ],
    [],
  );

  const card = React.useMemo(
    () => ({
      primary: (row: ReportDefinition) => (
        <Link
          href={`/app/reports/${row.code}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.title}
        </Link>
      ),
      secondary: (row: ReportDefinition) => row.category,
      trailing: (row: ReportDefinition) => `${formatNumber(row.columns.length)} cols`,
    }),
    [],
  );

  const meta = isFiltered
    ? `${formatNumber(visible.length)} of ${formatNumber(reports.length)} reports`
    : `${formatNumber(reports.length)} report${reports.length === 1 ? "" : "s"} · ${formatNumber(categories.length)} categor${categories.length === 1 ? "y" : "ies"}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Named reports backed by real sales, cash and purchasing data."
        meta={reportsQuery.isSuccess ? meta : undefined}
        actions={
          <Link
            href="/app/reports/fbr"
            className="text-small font-medium text-primary underline-offset-4 hover:underline"
          >
            FBR Tax Summary →
          </Link>
        }
      />

      <QueryBoundary
        query={reportsQuery}
        what="the report catalog"
        moduleLabel="Reporting"
        isEmpty={reports.length === 0}
        loading={
          <div className="space-y-(--space-md)">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
        empty={
          <EmptyState title="No reports available" description="The report catalog is empty." />
        }
      >
        <div className="space-y-(--space-lg)">
          <FilterBar
            title="Report catalog"
            filters={[
              {
                id: "category",
                label: "Category",
                value: category,
                onChange: setCategory,
                options: categories,
                testId: "reports-filter-category",
              },
            ]}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search reports",
              placeholder: "Search reports…",
            }}
            onClearAll={clearAll}
          />

          <DataGrid
            columns={columns}
            data={visible}
            card={card}
            label="Report catalog"
            isFiltered={isFiltered}
            onClearFilters={clearAll}
            emptyTitle="No reports available"
            emptyDescription="The report catalog is empty."
          />
        </div>
      </QueryBoundary>
    </>
  );
}

export default function ReportsPage() {
  return (
    <PermissionGuard require="reporting.report.view" fallback={<AccessDenied />}>
      <PageBody className="space-y-(--space-lg)">
        <ReportsBrowser />
      </PageBody>
    </PermissionGuard>
  );
}

"use client";

import Link from "next/link";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useReports } from "@/lib/hooks/reporting/use-reports";

function ReportsBrowser() {
  const { data, isLoading } = useReports();
  const reports = data ?? [];

  const byCategory = new Map<string, typeof reports>();
  for (const report of reports) {
    const bucket = byCategory.get(report.category) ?? [];
    bucket.push(report);
    byCategory.set(report.category, bucket);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Named reports backed by real sales, cash and purchasing data.
          </p>
        </div>
        <Link
          href="/app/reports/fbr"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          FBR Tax Summary →
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState title="No reports available" description="The report catalog is empty." />
      ) : (
        Array.from(byCategory.entries()).map(([category, items]) => (
          <div key={category} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <ul className="divide-y rounded-lg border border-border">
              {items.map((report) => (
                <li key={report.code}>
                  <Link
                    href={`/app/reports/${report.code}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/40"
                  >
                    <span className="font-medium">{report.title}</span>
                    <span className="text-xs text-muted-foreground">{report.columns.length} columns</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <PermissionGuard require="reporting.report.view" fallback={<AccessDenied />}>
      <div className="p-6">
        <ReportsBrowser />
      </div>
    </PermissionGuard>
  );
}

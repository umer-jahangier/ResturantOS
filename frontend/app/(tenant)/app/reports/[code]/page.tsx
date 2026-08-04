"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { ReportTable } from "@/components/reporting/ReportTable";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useReports, useRunReport } from "@/lib/hooks/reporting/use-reports";
import { thisMonthRange, type PeriodRange } from "@/components/purchasing/PeriodPicker";

interface ReportRunPageProps {
  params: Promise<{ code: string }>;
}

function ReportRunner({ code }: { code: string }) {
  const { branchId } = useCurrentUser();
  const { data: reports } = useReports();
  const [period, setPeriod] = useState<PeriodRange>(() => thisMonthRange());

  const definition = reports?.find((r) => r.code === code);
  const { data: result, isLoading } = useRunReport(code, {
    branchId,
    from: period.from,
    to: period.to,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/reports" className="text-sm text-muted-foreground hover:underline">
          ← All reports
        </Link>
        <h1 className="text-xl font-semibold">{definition?.title ?? code}</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            aria-label="Report period from"
            value={period.from}
            max={period.to}
            onChange={(e) => setPeriod({ from: e.target.value, to: period.to })}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            aria-label="Report period to"
            value={period.to}
            min={period.from}
            onChange={(e) => setPeriod({ from: period.from, to: e.target.value })}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      </div>

      <ReportTable result={result} isLoading={isLoading} />
    </div>
  );
}

export default function ReportRunPage({ params }: ReportRunPageProps) {
  const { code } = use(params);
  return (
    <PermissionGuard require="reporting.report.view" fallback={<AccessDenied />}>
      <div className="p-6">
        <ReportRunner code={code} />
      </div>
    </PermissionGuard>
  );
}

"use client";

import { useMemo, useState } from "react";
import { usePeriods } from "@/lib/hooks/finance/use-periods";
import { useFinanceSetupStatus } from "@/lib/hooks/finance/use-accounts";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";
import { PeriodStatusChip } from "@/components/finance/PeriodStatusChip";
import { PeriodCloseModal } from "@/components/finance/PeriodCloseModal";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { FiscalYearNav } from "@/components/finance/FiscalYearNav";
import { ProvisionPeriodDialog } from "@/components/finance/ProvisionPeriodDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import type { AccountingPeriod } from "@/lib/models/finance.model";

// URL: /app/finance/periods
export default function PeriodsPage() {
  const [fiscalYear, setFiscalYear] = useState(() => currentPakistanFiscalYear());
  // GA-001: `!isLoading && !periods?.length` rendered "No periods found" for a failed read, and
  // the copy then advised provisioning periods that may well already exist. Double-provisioning a
  // fiscal year is not a harmless retry.
  const periodsQuery = usePeriods(fiscalYear);
  const periods = periodsQuery.data;
  const { data: setupStatus } = useFinanceSetupStatus();
  const [closingPeriod, setClosingPeriod] = useState<AccountingPeriod | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const columns = useMemo<ColumnDef<AccountingPeriod, unknown>[]>(
    () => [
      {
        id: "periodNo",
        accessorKey: "periodNo",
        header: "Period",
        cell: ({ row }) => <span className="font-medium">Period {row.original.periodNo}</span>,
      },
      {
        id: "startDate",
        accessorKey: "startDate",
        header: "Start date",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.startDate}</span>
        ),
      },
      {
        id: "endDate",
        accessorKey: "endDate",
        header: "End date",
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.endDate}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <PeriodStatusChip status={row.original.status} />,
      },
      {
        id: "lockedBy",
        accessorKey: "lockedBy",
        header: "Locked by",
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.lockedBy ?? "—"}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.status === "OPEN" ? (
            <Button variant="outline" size="sm" onClick={() => setClosingPeriod(row.original)}>
              Close Period
            </Button>
          ) : null,
      },
    ],
    [],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Accounting Periods"
        description={`FY ${fiscalYear - 1}–${fiscalYear} (Jul – Jun)`}
        actions={
          <>
            <FiscalYearNav fiscalYear={fiscalYear} onChange={setFiscalYear} />
            <PermissionGuard require="finance.period.open">
              <Button variant="outline" size="sm" onClick={() => setProvisionOpen(true)}>
                Provision Periods
              </Button>
            </PermissionGuard>
          </>
        }
      />

      <QueryBoundary
        query={periodsQuery}
        what={`periods for FY ${fiscalYear}`}
        isEmpty={!periods?.length}
        loading={
          <div className="space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        }
        empty={
          <FinanceEmptyState
            title="No periods found"
            description={
              setupStatus?.provisioned
                ? `No periods provisioned for FY ${fiscalYear} yet. Use "Provision Periods" above to open it.`
                : 'No chart of accounts or periods yet for this tenant. An Owner, Tenant Admin, or Accountant can provision them using "Provision Periods" above.'
            }
          />
        }
      >
        <DataGrid
          label={`Accounting periods for FY ${fiscalYear}`}
          columns={columns}
          data={periods ?? []}
          pageSize={50}
          emptyTitle="No periods found"
          card={{
            primary: (p) => `Period ${p.periodNo}`,
            secondary: (p) => `${p.startDate} – ${p.endDate}`,
            trailing: (p) => <PeriodStatusChip status={p.status} />,
          }}
        />
      </QueryBoundary>

      {closingPeriod && (
        <PeriodCloseModal
          period={closingPeriod}
          onClose={() => setClosingPeriod(null)}
          onSuccess={() => setClosingPeriod(null)}
        />
      )}

      <ProvisionPeriodDialog
        key={fiscalYear}
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        initialFiscalYear={fiscalYear}
      />
    </PageBody>
  );
}

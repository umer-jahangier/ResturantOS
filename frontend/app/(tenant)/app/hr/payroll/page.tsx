"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StepUpRequiredNotice } from "@/components/auth/step-up-required-notice";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Input } from "@/components/ui/input";
import { InsetRow } from "@/components/ui/inset-row";
import { Label } from "@/components/ui/label";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  useApprovePayrollRun,
  useCalculatePayrollRun,
  useCreatePayrollRun,
  useLabourCost,
  usePayPayrollRun,
  usePayrollRuns,
  usePayslips,
} from "@/lib/hooks/hr/use-payroll";
import { formatNumber } from "@/lib/format/locale";
import type { ApiError } from "@/lib/errors";
import type { Payslip, PayrollRun } from "@/lib/models/hr.model";

// GA-078: HR formatted money itself — `₨ ${(paisa / 100).toLocaleString()}` — instead of going
// through `MoneyDisplay`. Two consequences, both visible in a payroll column: the symbol was `₨`
// where the rest of the product uses `Rs`, and `toLocaleString()` drops trailing zeros, so
// 250000 paisa rendered "₨ 2,500" and 250050 rendered "₨ 2,500.5". Decimal points stopped
// aligning down a salary column — the one place in a product where a misread digit costs money.
// `lib/adapters/shared.ts:1-2` states the rule: money is integer paisa and is NEVER divided by
// 100 in a component. Every HR amount now renders through the shared component, which fixes the
// symbol, pins two decimals, and brings `tabular-nums` with it.

/** A run's status, in the token set, with the word — never a bare string in a muted span. */
const RUN_STATUS: Record<string, { status: "pending" | "active" | "success" | "warning"; label: string }> = {
  DRAFT: { status: "pending", label: "Draft" },
  CALCULATED: { status: "warning", label: "Calculated" },
  APPROVED: { status: "active", label: "Approved" },
  PAID: { status: "success", label: "Paid" },
};

function runStatus(status: string) {
  return RUN_STATUS[status] ?? { status: "pending" as const, label: status };
}

export default function PayrollPage() {
  const { data: runs, isLoading, isError, error, refetch } = usePayrollRuns();
  const createRun = useCreatePayrollRun();
  const calculateRun = useCalculatePayrollRun();
  const approveRun = useApprovePayrollRun();
  const payRun = usePayPayrollRun();

  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  // Only the id is stored; the run itself is looked up from the freshly-fetched list so an
  // expanded row can never go on showing a pre-mutation status.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stepUpRequired, setStepUpRequired] = useState(false);

  const rows = runs ?? [];
  const expanded: PayrollRun | null = rows.find((r) => r.id === expandedId) ?? null;

  // Both keyed off the expanded run; TanStack keeps them disabled until one is open, so
  // collapsing simply stops the fetches instead of leaving stale rows behind.
  const payslipsQuery = usePayslips(expanded?.id ?? null);
  const labourQuery = useLabourCost(
    expanded?.branchId ?? null,
    expanded?.periodMonth ?? null,
    expanded?.periodYear ?? null,
  );

  function toastResult(successMessage: string) {
    return {
      onSuccess: () => toast.success(successMessage),
      onError: () => toast.error("Action failed"),
    };
  }

  // Approval alone is step-up gated, and its one expected failure is not a failure: the
  // `totp_verified` claim is not carried across token refresh, so roughly an hour after signing
  // in the server starts answering TOTP_REQUIRED. A toast reading "Action failed" would send an
  // approver hunting a payroll problem that does not exist, so that case gets a persistent notice
  // with the one action that resolves it instead.
  function approveResult() {
    return {
      onSuccess: () => {
        setStepUpRequired(false);
        toast.success("Approved");
      },
      onError: (error: ApiError) => {
        if (error.isTotpRequired()) {
          setStepUpRequired(true);
          return;
        }
        toast.error("Action failed");
      },
    };
  }

  const payslipColumns = useMemo<ColumnDef<Payslip, unknown>[]>(
    () => [
      {
        id: "employeeId",
        accessorKey: "employeeId",
        header: "Employee",
        // The endpoint returns an id and no name. A truncated UUID is not a person's name and is
        // not dressed up as one — `columns.ts`'s `isUuid` records the same shortfall on the PO
        // list, where the honest fix was to stop claiming to render a human identifier.
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.employeeId.slice(0, 8)}</span>
        ),
      },
      {
        id: "basic",
        accessorKey: "basicPaisa",
        header: "Basic",
        cell: ({ row }) => <Amount paisa={row.original.basicPaisa} />,
      },
      {
        id: "gross",
        accessorKey: "grossPaisa",
        header: "Gross",
        cell: ({ row }) => <Amount paisa={row.original.grossPaisa} />,
      },
      {
        id: "incomeTax",
        header: "Income tax",
        enableSorting: false,
        cell: ({ row }) => <Deduction paisa={row.original.deductions.income_tax_paisa ?? 0} />,
      },
      {
        id: "eobi",
        header: "EOBI",
        enableSorting: false,
        cell: ({ row }) => (
          <Deduction paisa={row.original.deductions.eobi_employee_paisa ?? 0} />
        ),
      },
      {
        id: "late",
        header: "Late",
        enableSorting: false,
        cell: ({ row }) => (
          <Deduction paisa={row.original.deductions.late_arrival_paisa ?? 0} />
        ),
      },
      {
        id: "net",
        accessorKey: "netPaisa",
        header: "Net",
        cell: ({ row }) => <Amount paisa={row.original.netPaisa} emphasis />,
      },
    ],
    [],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Payroll runs"
        description="One run per month per branch. A run is calculated, approved, then marked paid."
        actions={
          <PermissionGuard require="hr.payroll.run" fallback={null}>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="run-month">Month</Label>
                <Input
                  id="run-month"
                  type="number"
                  className="w-20"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="run-year">Year</Label>
                <Input
                  id="run-year"
                  type="number"
                  className="w-24"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
              <Button
                disabled={createRun.isPending}
                onClick={() =>
                  createRun.mutate(
                    { month: Number(month), year: Number(year) },
                    toastResult("Run created"),
                  )
                }
              >
                New run
              </Button>
            </div>
          </PermissionGuard>
        }
      />

      {stepUpRequired && <StepUpRequiredNotice action="approve this payroll run" />}

      {/* Payroll is money: a failed list rendering as "No payroll runs yet." could send
          someone to create a duplicate run for a period that already has one. */}
      {isError ? (
        <HrErrorNotice what="payroll runs" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <ul className="space-y-(--space-sm)">
          {rows.map((run) => {
            const badge = runStatus(run.status);
            const isOpen = expanded?.id === run.id;
            return (
              <li key={run.id} className="space-y-(--space-sm)">
                <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
                  <div className="min-w-0 flex-1">
                    <InsetRow
                      as="div"
                      onSelect={() => setExpandedId((prev) => (prev === run.id ? null : run.id))}
                      actionLabel={`${isOpen ? "Hide" : "Show"} payslips for ${run.periodMonth}/${run.periodYear}`}
                      selected={isOpen}
                      primary={
                        <span className="flex items-center gap-(--space-sm)">
                          <span className="tabular-nums font-medium">
                            {run.periodMonth}/{run.periodYear}
                          </span>
                          <StatusBadge status={badge.status} label={badge.label} />
                        </span>
                      }
                      secondary={
                        <span className="flex flex-wrap items-baseline gap-(--space-sm)">
                          <span>
                            Gross <MoneyDisplay paisa={run.totalGrossPaisa} />
                          </span>
                          <span>
                            Net <MoneyDisplay paisa={run.totalNetPaisa} />
                          </span>
                        </span>
                      }
                    />
                  </div>

                  <div className="flex gap-2">
                    {(run.status === "DRAFT" || run.status === "CALCULATED") && (
                      <PermissionGuard require="hr.payroll.run" fallback={null}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={calculateRun.isPending}
                          onClick={() => calculateRun.mutate(run.id, toastResult("Calculated"))}
                        >
                          Calculate
                        </Button>
                      </PermissionGuard>
                    )}
                    {run.status === "CALCULATED" && (
                      <PermissionGuard require="hr.payroll.approve" fallback={null}>
                        <Button
                          size="sm"
                          disabled={approveRun.isPending}
                          onClick={() => approveRun.mutate(run.id, approveResult())}
                        >
                          Approve
                        </Button>
                      </PermissionGuard>
                    )}
                    {run.status === "APPROVED" && (
                      <PermissionGuard require="hr.payroll.approve" fallback={null}>
                        <Button
                          size="sm"
                          disabled={payRun.isPending}
                          onClick={() => payRun.mutate(run.id, toastResult("Paid"))}
                        >
                          Mark paid
                        </Button>
                      </PermissionGuard>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-(--space-md) border-l-2 border-border pl-(--space-md)">
                    {/* Labour cost as a percentage of revenue is exactly the kind of figure
                        D-38-16 is about: the server returns `labourCostPct: null` when it has no
                        revenue to divide by, and a `0.0%` there would be a claim that this branch
                        took no money. `StatTile`'s union will not let a value and a reason be
                        passed together, so the absence cannot be quietly filled in. */}
                    {labourQuery.isError && (
                      <p className="text-small text-destructive" role="alert">
                        Labour cost unavailable for this run.
                      </p>
                    )}
                    {labourQuery.data && (
                      <div className="grid gap-(--space-md) sm:grid-cols-2">
                        <StatTile
                          label="Labour cost"
                          density="compact"
                          value={<MoneyDisplay paisa={labourQuery.data.labourCostPaisa} />}
                        />
                        {labourQuery.data.labourCostPct != null ? (
                          <StatTile
                            label="Share of revenue"
                            density="compact"
                            value={`${formatNumber(labourQuery.data.labourCostPct, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}%`}
                          />
                        ) : (
                          <StatTile
                            label="Share of revenue"
                            density="compact"
                            unavailableReason="Revenue for this period is not available, so the share cannot be worked out."
                          />
                        )}
                      </div>
                    )}

                    {payslipsQuery.isError ? (
                      <HrErrorNotice
                        what="the payslips for this run"
                        error={payslipsQuery.error}
                        onRetry={() => void payslipsQuery.refetch()}
                      />
                    ) : (
                      <DataGrid
                        label={`Payslips for ${run.periodMonth}/${run.periodYear}`}
                        columns={payslipColumns}
                        data={payslipsQuery.data ?? []}
                        isLoading={payslipsQuery.isLoading}
                        density="compact"
                        emptyTitle="No payslips in this run"
                        emptyDescription="Calculate the run to produce payslips."
                        card={{
                          primary: (p) => p.employeeId.slice(0, 8),
                          secondary: () => "Gross to net",
                          trailing: (p) => <MoneyDisplay paisa={p.netPaisa} />,
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="text-small text-muted-foreground">No payroll runs yet.</li>
          )}
        </ul>
      )}
    </PageBody>
  );
}

function Amount({ paisa, emphasis }: { paisa: number; emphasis?: boolean }) {
  return (
    <span className="block text-right">
      <MoneyDisplay paisa={paisa} className={emphasis ? "font-semibold" : undefined} />
    </span>
  );
}

/**
 * A deduction, in accounting parentheses.
 *
 * <p>The demo's P&L writes every deduction that way and it is the one piece of that panel worth
 * carrying over (D-38-15 adopts its FORMATTING, D-38-16 forbids its figures). A payslip is the
 * place in this product where it earns its keep most plainly: five money columns run left to
 * right and three of them come OFF the gross, which the old rendering — five identical
 * `Rs 1,234.00`s in a row — did not say anywhere.
 *
 * <p>Zero is an em dash. A deduction of `Rs 0.00` reads as a computed figure; most payslips carry
 * no late-arrival deduction at all, and that is an absence.
 */
function Deduction({ paisa }: { paisa: number }) {
  if (paisa === 0) {
    return (
      <span className="block text-right tabular-nums text-foreground-tertiary" aria-label="none">
        —
      </span>
    );
  }
  return (
    <span className="block text-right">
      <MoneyDisplay paisa={-paisa} sign="accounting" className="text-destructive" />
    </span>
  );
}

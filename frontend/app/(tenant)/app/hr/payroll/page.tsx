"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { StepUpRequiredNotice } from "@/components/auth/step-up-required-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useApprovePayrollRun,
  useCalculatePayrollRun,
  useCreatePayrollRun,
  useLabourCost,
  usePayPayrollRun,
  usePayrollRuns,
  usePayslips,
} from "@/lib/hooks/hr/use-payroll";
import type { ApiError } from "@/lib/errors";
import type { PayrollRun } from "@/lib/models/hr.model";

function rupees(paisa: number): string {
  return `₨ ${(paisa / 100).toLocaleString()}`;
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Payroll runs</h1>
        <PermissionGuard require="hr.payroll.run" fallback={null}>
          <div className="flex gap-2">
            <Input
              type="number"
              className="w-20"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <Input
              type="number"
              className="w-24"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
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
      </div>

      {stepUpRequired && <StepUpRequiredNotice action="approve this payroll run" />}

      {/* Payroll is money: a failed list rendering as "No payroll runs yet." could send
          someone to create a duplicate run for a period that already has one. */}
      {isError ? (
        <HrErrorNotice what="payroll runs" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {rows.map((run) => (
            <div key={run.id} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <button
                  className="text-left"
                  onClick={() => setExpandedId((prev) => (prev === run.id ? null : run.id))}
                >
                  <span className="font-medium">
                    {run.periodMonth}/{run.periodYear}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {run.status} · gross {rupees(run.totalGrossPaisa)} · net{" "}
                    {rupees(run.totalNetPaisa)}
                  </span>
                </button>
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

              {expanded?.id === run.id && (
                <div className="mt-3 space-y-2 border-t pt-2">
                  {labourQuery.isError && (
                    <p className="text-sm text-destructive" role="alert">
                      Labour cost unavailable for this run.
                    </p>
                  )}
                  {labourQuery.data && (
                    <p className="text-sm">
                      Labour cost: {rupees(labourQuery.data.labourCostPaisa)}
                      {labourQuery.data.labourCostPct != null
                        ? ` · ${labourQuery.data.labourCostPct.toFixed(1)}% of revenue`
                        : " · revenue unavailable"}
                    </p>
                  )}

                  {payslipsQuery.isError ? (
                    <HrErrorNotice
                      what="the payslips for this run"
                      error={payslipsQuery.error}
                      onRetry={() => void payslipsQuery.refetch()}
                    />
                  ) : payslipsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading payslips…</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-1">Employee</th>
                          <th>Basic</th>
                          <th>Gross</th>
                          <th>Income tax</th>
                          <th>EOBI</th>
                          <th>Late</th>
                          <th>Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(payslipsQuery.data ?? []).map((p) => (
                          <tr key={p.id} className="border-b">
                            <td className="py-1">{p.employeeId.slice(0, 8)}</td>
                            <td>{rupees(p.basicPaisa)}</td>
                            <td>{rupees(p.grossPaisa)}</td>
                            <td>{rupees(p.deductions.income_tax_paisa ?? 0)}</td>
                            <td>{rupees(p.deductions.eobi_employee_paisa ?? 0)}</td>
                            <td>{rupees(p.deductions.late_arrival_paisa ?? 0)}</td>
                            <td>{rupees(p.netPaisa)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No payroll runs yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

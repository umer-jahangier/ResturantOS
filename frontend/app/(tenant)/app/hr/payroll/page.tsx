"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HrRepository } from "@/lib/repositories/hr.repository";
import type { LabourCostByBranch, PayrollRun, Payslip } from "@/lib/models/hr.model";

function rupees(paisa: number): string {
  return `₨ ${(paisa / 100).toLocaleString()}`;
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [labour, setLabour] = useState<LabourCostByBranch | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRuns(await HrRepository.listRuns());
    } catch {
      toast.error("Failed to load payroll runs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch {
      toast.error("Action failed");
    }
  }

  async function openRun(run: PayrollRun) {
    if (expanded === run.id) {
      setExpanded(null);
      return;
    }
    setExpanded(run.id);
    try {
      setPayslips(await HrRepository.listPayslips(run.id));
      if (run.branchId) {
        setLabour(await HrRepository.labourCostByBranch(run.branchId, run.periodMonth, run.periodYear));
      } else {
        setLabour(null);
      }
    } catch {
      toast.error("Failed to load payslips");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Payroll runs</h1>
        <PermissionGuard require="hr.payroll.run" fallback={null}>
          <div className="flex gap-2">
            <Input type="number" className="w-20" value={month} onChange={(e) => setMonth(e.target.value)} />
            <Input type="number" className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />
            <Button onClick={() => act(() => HrRepository.createRun(Number(month), Number(year)), "Run created")}>
              New run
            </Button>
          </div>
        </PermissionGuard>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.id} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <button className="text-left" onClick={() => openRun(run)}>
                  <span className="font-medium">{run.periodMonth}/{run.periodYear}</span>{" "}
                  <span className="text-muted-foreground">· {run.status} · gross {rupees(run.totalGrossPaisa)} · net {rupees(run.totalNetPaisa)}</span>
                </button>
                <div className="flex gap-2">
                  {(run.status === "DRAFT" || run.status === "CALCULATED") && (
                    <PermissionGuard require="hr.payroll.run" fallback={null}>
                      <Button size="sm" variant="outline" onClick={() => act(() => HrRepository.calculateRun(run.id), "Calculated")}>Calculate</Button>
                    </PermissionGuard>
                  )}
                  {run.status === "CALCULATED" && (
                    <PermissionGuard require="hr.payroll.approve" fallback={null}>
                      <Button size="sm" onClick={() => {
                        const code = window.prompt("Enter TOTP code to approve") ?? "";
                        if (code) void act(() => HrRepository.approveRun(run.id, code), "Approved");
                      }}>Approve (TOTP)</Button>
                    </PermissionGuard>
                  )}
                  {run.status === "APPROVED" && (
                    <PermissionGuard require="hr.payroll.approve" fallback={null}>
                      <Button size="sm" onClick={() => act(() => HrRepository.payRun(run.id), "Paid")}>Mark paid</Button>
                    </PermissionGuard>
                  )}
                </div>
              </div>

              {expanded === run.id && (
                <div className="mt-3 space-y-2 border-t pt-2">
                  {labour && (
                    <p className="text-sm">
                      Labour cost: {rupees(labour.labourCostPaisa)}
                      {labour.labourCostPct != null ? ` · ${labour.labourCostPct.toFixed(1)}% of revenue` : " · revenue unavailable"}
                    </p>
                  )}
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
                      {payslips.map((p) => (
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
                </div>
              )}
            </div>
          ))}
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No payroll runs yet.</p>}
        </div>
      )}
    </div>
  );
}

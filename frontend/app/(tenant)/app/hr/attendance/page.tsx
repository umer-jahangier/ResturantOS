"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HrRepository } from "@/lib/repositories/hr.repository";
import type { AttendanceSummary, Employee, LeaveType, QuarantinedPunch } from "@/lib/models/hr.model";

export default function AttendancePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantinedPunch[]>([]);
  const [selectedEmp, setSelectedEmp] = useState("");
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const [leaveForm, setLeaveForm] = useState({ employeeId: "", leaveTypeId: "", startDate: today, endDate: today, reason: "" });
  const [approveId, setApproveId] = useState("");

  async function loadAll() {
    try {
      const [emps, types, q] = await Promise.all([
        HrRepository.listEmployees(),
        HrRepository.listLeaveTypes(),
        HrRepository.listQuarantine(),
      ]);
      setEmployees(emps);
      setLeaveTypes(types);
      setQuarantine(q);
    } catch {
      toast.error("Failed to load HR data");
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function clock(kind: "in" | "out") {
    if (!selectedEmp) return;
    try {
      if (kind === "in") await HrRepository.clockIn(selectedEmp);
      else await HrRepository.clockOut(selectedEmp);
      setSummary(await HrRepository.summary(selectedEmp, today));
      toast.success(`Clock-${kind} recorded`);
    } catch {
      toast.error("Clock failed");
    }
  }

  async function resolveQ(q: QuarantinedPunch, employeeId: string) {
    if (!employeeId) return;
    try {
      await HrRepository.resolveQuarantine(q.id, employeeId);
      toast.success("Quarantine resolved — mapping saved");
      setQuarantine(await HrRepository.listQuarantine());
    } catch {
      toast.error("Resolve failed");
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Manual clock + daily summary */}
      <section className="space-y-2 rounded border p-3">
        <h2 className="font-semibold">Time & attendance</h2>
        <select className="w-full rounded border px-2 py-1 text-sm" value={selectedEmp} onChange={(e) => setSelectedEmp(e.target.value)}>
          <option value="">Select employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</option>)}
        </select>
        <PermissionGuard require="hr.attendance.manage" fallback={<p className="text-xs text-muted-foreground">Clock actions need hr.attendance.manage.</p>}>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => clock("in")}>Clock in</Button>
            <Button size="sm" variant="outline" onClick={() => clock("out")}>Clock out</Button>
          </div>
        </PermissionGuard>
        {summary && (
          <p className="text-sm text-muted-foreground">
            {summary.date}: late {summary.lateMinutes}m · early-leave {summary.earlyMinutes}m
          </p>
        )}
      </section>

      {/* Leave */}
      <section className="space-y-2 rounded border p-3">
        <h2 className="font-semibold">Leave</h2>
        <select className="w-full rounded border px-2 py-1 text-sm" value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}>
          <option value="">Employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
        </select>
        <select className="w-full rounded border px-2 py-1 text-sm" value={leaveForm.leaveTypeId} onChange={(e) => setLeaveForm({ ...leaveForm, leaveTypeId: e.target.value })}>
          <option value="">Leave type…</option>
          {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex gap-2">
          <Input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
          <Input type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
        </div>
        <Button size="sm" onClick={async () => {
          try {
            const r = await HrRepository.requestLeave(leaveForm);
            toast.success(`Leave requested (${r.id.slice(0, 8)})`);
          } catch { toast.error("Request failed"); }
        }}>Request leave</Button>
        <PermissionGuard require="hr.leave.approve" fallback={null}>
          <div className="flex gap-2 border-t pt-2">
            <Input placeholder="Leave request id" value={approveId} onChange={(e) => setApproveId(e.target.value)} />
            <Button size="sm" onClick={() => approveId && void HrRepository.approveLeave(approveId).then(() => toast.success("Approved")).catch(() => toast.error("Failed"))}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => approveId && void HrRepository.rejectLeave(approveId).then(() => toast.success("Rejected")).catch(() => toast.error("Failed"))}>Reject</Button>
          </div>
        </PermissionGuard>
        {leaveTypes.length === 0 && (
          <Button size="sm" variant="ghost" onClick={() => void HrRepository.ensureLeaveDefaults().then(setLeaveTypes)}>Seed default leave types</Button>
        )}
      </section>

      {/* Quarantine */}
      <section className="space-y-2 rounded border p-3 md:col-span-2">
        <h2 className="font-semibold">Attendance quarantine ({quarantine.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground"><th className="py-1">Device ref</th><th>Type</th><th>Reported</th><th>Resolve to employee</th></tr>
          </thead>
          <tbody>
            {quarantine.map((q) => (
              <tr key={q.id} className="border-b">
                <td className="py-1">{q.deviceUserRef}</td>
                <td>{q.punchType ?? "—"}</td>
                <td>{q.deviceReportedAt}</td>
                <td>
                  <PermissionGuard require="hr.attendance.manage" fallback={<span className="text-xs text-muted-foreground">needs manage</span>}>
                    <select className="rounded border px-1 text-sm" defaultValue="" onChange={(e) => resolveQ(q, e.target.value)}>
                      <option value="">Map to…</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                    </select>
                  </PermissionGuard>
                </td>
              </tr>
            ))}
            {quarantine.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-muted-foreground">No quarantined punches.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEmployees } from "@/lib/hooks/hr/use-employees";
import {
  useAttendanceSummary,
  useClockPunch,
  useDecideLeave,
  useEnsureLeaveDefaults,
  useLeaveTypes,
  useQuarantine,
  useRequestLeave,
  useResolveQuarantine,
} from "@/lib/hooks/hr/use-attendance";
import type { QuarantinedPunch } from "@/lib/models/hr.model";

export default function AttendancePage() {
  const employeesQuery = useEmployees();
  const leaveTypesQuery = useLeaveTypes();
  const quarantineQuery = useQuarantine();

  const clockPunch = useClockPunch();
  const resolveQuarantine = useResolveQuarantine();
  const requestLeave = useRequestLeave();
  const decideLeave = useDecideLeave();
  const ensureLeaveDefaults = useEnsureLeaveDefaults();

  const [selectedEmp, setSelectedEmp] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  // Loads as soon as an employee is picked (and refreshes on every punch, because
  // useClockPunch invalidates the attendance prefix) — previously this only ever appeared
  // after clocking, so selecting someone showed nothing at all about their day.
  const summaryQuery = useAttendanceSummary(selectedEmp, today);

  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    startDate: today,
    endDate: today,
    reason: "",
  });
  const [approveId, setApproveId] = useState("");

  const employees = employeesQuery.data ?? [];
  const leaveTypes = leaveTypesQuery.data ?? [];
  const quarantine = quarantineQuery.data ?? [];

  function clock(kind: "in" | "out") {
    if (!selectedEmp) return;
    clockPunch.mutate(
      { employeeId: selectedEmp, kind },
      {
        onSuccess: () => toast.success(`Clock-${kind} recorded`),
        onError: () => toast.error("Clock failed"),
      },
    );
  }

  function resolveQ(q: QuarantinedPunch, employeeId: string) {
    if (!employeeId) return;
    resolveQuarantine.mutate(
      { id: q.id, employeeId },
      {
        onSuccess: () => toast.success("Quarantine resolved — mapping saved"),
        onError: () => toast.error("Resolve failed"),
      },
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* The roster feeds all three panels below, so its failure is reported once, up top —
          otherwise every employee dropdown would silently render as "no staff exist". */}
      {employeesQuery.isError && (
        <div className="md:col-span-2">
          <HrErrorNotice
            what="the employee roster"
            error={employeesQuery.error}
            onRetry={() => void employeesQuery.refetch()}
          />
        </div>
      )}

      {/* Manual clock + daily summary */}
      <section className="space-y-2 rounded border p-3">
        <h2 className="font-semibold">Time &amp; attendance</h2>
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={selectedEmp}
          onChange={(e) => setSelectedEmp(e.target.value)}
        >
          <option value="">
            {employeesQuery.isLoading ? "Loading employees…" : "Select employee…"}
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.employeeNo} — {e.fullName}
            </option>
          ))}
        </select>
        <PermissionGuard
          require="hr.attendance.manage"
          fallback={
            <p className="text-xs text-muted-foreground">
              Clock actions need hr.attendance.manage.
            </p>
          }
        >
          <div className="flex gap-2">
            <Button size="sm" disabled={clockPunch.isPending} onClick={() => clock("in")}>
              Clock in
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={clockPunch.isPending}
              onClick={() => clock("out")}
            >
              Clock out
            </Button>
          </div>
        </PermissionGuard>
        {selectedEmp && summaryQuery.isError && (
          <p className="text-sm text-destructive" role="alert">
            Couldn&apos;t load today&apos;s attendance summary.
          </p>
        )}
        {summaryQuery.data && (
          <p className="text-sm text-muted-foreground">
            {summaryQuery.data.date}: late {summaryQuery.data.lateMinutes}m · early-leave{" "}
            {summaryQuery.data.earlyMinutes}m
          </p>
        )}
      </section>

      {/* Leave */}
      <section className="space-y-2 rounded border p-3">
        <h2 className="font-semibold">Leave</h2>
        {leaveTypesQuery.isError && (
          <HrErrorNotice
            what="leave types"
            error={leaveTypesQuery.error}
            onRetry={() => void leaveTypesQuery.refetch()}
          />
        )}
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={leaveForm.employeeId}
          onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}
        >
          <option value="">Employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </select>
        <select
          className="w-full rounded border px-2 py-1 text-sm"
          value={leaveForm.leaveTypeId}
          onChange={(e) => setLeaveForm({ ...leaveForm, leaveTypeId: e.target.value })}
        >
          <option value="">Leave type…</option>
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Input
            type="date"
            value={leaveForm.startDate}
            onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
          />
          <Input
            type="date"
            value={leaveForm.endDate}
            onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
          />
        </div>
        <Button
          size="sm"
          disabled={requestLeave.isPending}
          onClick={() =>
            requestLeave.mutate(leaveForm, {
              onSuccess: (r) => toast.success(`Leave requested (${r.id.slice(0, 8)})`),
              onError: () => toast.error("Request failed"),
            })
          }
        >
          Request leave
        </Button>
        <PermissionGuard require="hr.leave.approve" fallback={null}>
          <div className="flex gap-2 border-t pt-2">
            <Input
              placeholder="Leave request id"
              value={approveId}
              onChange={(e) => setApproveId(e.target.value)}
            />
            <Button
              size="sm"
              disabled={decideLeave.isPending}
              onClick={() =>
                approveId &&
                decideLeave.mutate(
                  { id: approveId, decision: "approve" },
                  {
                    onSuccess: () => toast.success("Approved"),
                    onError: () => toast.error("Failed"),
                  },
                )
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decideLeave.isPending}
              onClick={() =>
                approveId &&
                decideLeave.mutate(
                  { id: approveId, decision: "reject" },
                  {
                    onSuccess: () => toast.success("Rejected"),
                    onError: () => toast.error("Failed"),
                  },
                )
              }
            >
              Reject
            </Button>
          </div>
        </PermissionGuard>
        {/* Only offered once the list is known to be genuinely empty — offering it after a
            failed load would invite seeding types that may already exist. */}
        {leaveTypesQuery.isSuccess && leaveTypes.length === 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={ensureLeaveDefaults.isPending}
            onClick={() =>
              ensureLeaveDefaults.mutate(undefined, {
                onError: () => toast.error("Failed to seed leave types"),
              })
            }
          >
            Seed default leave types
          </Button>
        )}
      </section>

      {/* Quarantine */}
      <section className="space-y-2 rounded border p-3 md:col-span-2">
        <h2 className="font-semibold">Attendance quarantine ({quarantine.length})</h2>
        {quarantineQuery.isError ? (
          <HrErrorNotice
            what="the quarantine queue"
            error={quarantineQuery.error}
            onRetry={() => void quarantineQuery.refetch()}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1">Device ref</th>
                <th>Type</th>
                <th>Reported</th>
                <th>Resolve to employee</th>
              </tr>
            </thead>
            <tbody>
              {quarantine.map((q) => (
                <tr key={q.id} className="border-b">
                  <td className="py-1">{q.deviceUserRef}</td>
                  <td>{q.punchType ?? "—"}</td>
                  <td>{q.deviceReportedAt}</td>
                  <td>
                    <PermissionGuard
                      require="hr.attendance.manage"
                      fallback={<span className="text-xs text-muted-foreground">needs manage</span>}
                    >
                      <select
                        className="rounded border px-1 text-sm"
                        defaultValue=""
                        onChange={(e) => resolveQ(q, e.target.value)}
                      >
                        <option value="">Map to…</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.fullName}
                          </option>
                        ))}
                      </select>
                    </PermissionGuard>
                  </td>
                </tr>
              ))}
              {quarantine.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-muted-foreground">
                    {quarantineQuery.isLoading ? "Loading…" : "No quarantined punches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

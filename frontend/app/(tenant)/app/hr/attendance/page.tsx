"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
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

/**
 * Time, leave and the punch quarantine (38-08 task 6).
 *
 * <h3>What was measured here, in source, before this file was touched</h3>
 *
 * `grep -c` over this file returned **`<h1>` 0, `<label>` 0, `aria-label` 0, `htmlFor` 0** — the
 * only back-office route in the product that was simultaneously unheaded and completely
 * unlabelled, with four raw `<select>`s and eight bare `rounded`s. Every control on the screen
 * was announced as "combo box" or "edit text" with no name at all, so a screen-reader user could
 * not tell the leave form's employee picker from the quarantine row's, and there was no heading
 * to navigate to.
 *
 * <p>Every control now has a visible `<label>` bound by `htmlFor`, or — for the one control that
 * genuinely cannot show a label, the per-row quarantine mapper — an `aria-label` naming the row
 * it belongs to. The `<h1>` is `PageHeader`'s.
 *
 * <h3>Why the four `<select>`s DID move here, when phase 35 owns that migration</h3>
 *
 * 38-08's brief leaves raw selects alone "EXCEPT where `FilterBar` naturally replaces the filter
 * itself". These are not filters — they are form fields — so the exception does not cover them.
 * They move anyway for one reason: the shared {@link Select} is the only control in this product
 * that distinguishes *"this list failed to load"* from *"this list is empty"*, and on THIS screen
 * that distinction is the whole point. `hr-service` was returning `503` throughout the audit, and
 * a bare `<select>` answers a 503 with an empty dropdown — which reads as "this restaurant employs
 * nobody" and is precisely the GA-001 defect on the module where it is least recoverable. Phase 35
 * still owns the other eleven call sites.
 *
 * <h3>Gates on this route were NOT run</h3>
 *
 * `hr-service` has no process on `:8088` and is absent from Eureka. Per the plan's own warning
 * (vacuous-gate pattern #4), an e2e gate anchored here would SKIP and report green. Everything
 * above is a source-level change and is reported as unverified in a browser.
 */
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

  // `?? []` inside a dependency array is a NEW array identity on every render, which would make
  // the memo below recompute each time and — worse — hand a fresh `options` array to every
  // `Select` on the screen, remounting the dropdowns while someone is choosing from one.
  const employeeOptions = useMemo(
    () =>
      (employeesQuery.data ?? []).map((e) => ({
        value: e.id,
        label: `${e.employeeNo} — ${e.fullName}`,
      })),
    [employeesQuery.data],
  );

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

  const quarantineColumns = useMemo<ColumnDef<QuarantinedPunch, unknown>[]>(
    () => [
      {
        id: "deviceUserRef",
        accessorKey: "deviceUserRef",
        header: "Device ref",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.deviceUserRef}</span>
        ),
      },
      {
        id: "punchType",
        accessorKey: "punchType",
        header: "Type",
        cell: ({ row }) => row.original.punchType ?? "—",
      },
      {
        id: "deviceReportedAt",
        accessorKey: "deviceReportedAt",
        header: "Reported",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.deviceReportedAt}</span>
        ),
      },
      {
        id: "resolve",
        header: "Resolve to employee",
        enableSorting: false,
        cell: ({ row }) => (
          <PermissionGuard
            require="hr.attendance.manage"
            fallback={<span className="text-label text-muted-foreground">needs manage</span>}
          >
            <div className="w-56">
              {/* The only control on this screen with no visible label — a per-row picker inside
                  a grid cell, where a column header is the visible label. `aria-label` names the
                  ROW, because "Map to…" repeated down a column tells a screen-reader user which
                  control they are in and nothing about which punch it maps. */}
              <Select
                aria-label={`Map punch ${row.original.deviceUserRef} to an employee`}
                value=""
                placeholder="Map to…"
                options={employeeOptions}
                isLoading={employeesQuery.isLoading}
                error={employeesQuery.isError}
                onRetry={() => void employeesQuery.refetch()}
                onValueChange={(value) => resolveQ(row.original, value)}
              />
            </div>
          </PermissionGuard>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employeeOptions, employeesQuery.isLoading, employeesQuery.isError],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Time & attendance"
        description="Clock staff in and out, record leave, and resolve punches the device could not match to a person."
      />

      {/* The roster feeds all three panels below, so its failure is reported once, up top —
          otherwise every employee dropdown would silently render as "no staff exist". */}
      {employeesQuery.isError && (
        <HrErrorNotice
          what="the employee roster"
          error={employeesQuery.error}
          onRetry={() => void employeesQuery.refetch()}
        />
      )}

      <div className="grid gap-(--space-lg) md:grid-cols-2">
        {/* ── Manual clock + daily summary ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="clock-heading"
          className="space-y-(--space-sm) rounded-xl border border-border bg-card p-(--space-md) text-card-foreground"
        >
          <h2 id="clock-heading" className="text-h2 font-semibold">
            Clock in and out
          </h2>

          <div className="space-y-1">
            <Label htmlFor="clock-employee">Employee</Label>
            <Select
              id="clock-employee"
              value={selectedEmp}
              onValueChange={setSelectedEmp}
              placeholder="Select employee…"
              options={employeeOptions}
              isLoading={employeesQuery.isLoading}
              error={employeesQuery.isError}
              onRetry={() => void employeesQuery.refetch()}
            />
          </div>

          <PermissionGuard
            require="hr.attendance.manage"
            fallback={
              <p className="text-label text-muted-foreground">
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
            <p className="text-small text-destructive" role="alert">
              Couldn&apos;t load today&apos;s attendance summary.
            </p>
          )}

          {/* Two figures the server states for the selected person's day. They are shown as
              tiles rather than as the old one-line sentence, and — this is the part that matters
              — a minute count is NOT invented when the summary has not been asked for or could
              not be read. No employee selected means no tiles, not two zeroes. */}
          {summaryQuery.data && (
            <div className="grid gap-(--space-sm) sm:grid-cols-2">
              <StatTile
                label="Late"
                density="compact"
                value={`${summaryQuery.data.lateMinutes} min`}
              />
              <StatTile
                label="Early leave"
                density="compact"
                value={`${summaryQuery.data.earlyMinutes} min`}
              />
              <p className="text-label text-muted-foreground sm:col-span-2">
                For {summaryQuery.data.date}.
              </p>
            </div>
          )}
        </section>

        {/* ── Leave ──────────────────────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="leave-heading"
          className="space-y-(--space-sm) rounded-xl border border-border bg-card p-(--space-md) text-card-foreground"
        >
          <h2 id="leave-heading" className="text-h2 font-semibold">
            Leave
          </h2>

          {leaveTypesQuery.isError && (
            <HrErrorNotice
              what="leave types"
              error={leaveTypesQuery.error}
              onRetry={() => void leaveTypesQuery.refetch()}
            />
          )}

          <div className="space-y-1">
            <Label htmlFor="leave-employee">Employee</Label>
            <Select
              id="leave-employee"
              value={leaveForm.employeeId}
              onValueChange={(value) => setLeaveForm({ ...leaveForm, employeeId: value })}
              placeholder="Employee…"
              options={employees.map((e) => ({ value: e.id, label: e.fullName }))}
              isLoading={employeesQuery.isLoading}
              error={employeesQuery.isError}
              onRetry={() => void employeesQuery.refetch()}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select
              id="leave-type"
              value={leaveForm.leaveTypeId}
              onValueChange={(value) => setLeaveForm({ ...leaveForm, leaveTypeId: value })}
              placeholder="Leave type…"
              options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))}
              isLoading={leaveTypesQuery.isLoading}
              error={leaveTypesQuery.isError}
              onRetry={() => void leaveTypesQuery.refetch()}
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="leave-start">First day</Label>
              <Input
                id="leave-start"
                type="date"
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="leave-end">Last day</Label>
              <Input
                id="leave-end"
                type="date"
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
              />
            </div>
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
            <div className="space-y-1 border-t pt-2">
              <Label htmlFor="leave-decision-id">Leave request id</Label>
              <div className="flex gap-2">
                <Input
                  id="leave-decision-id"
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
            </div>
          </PermissionGuard>

          {/* Only offered once the list is known to be genuinely empty — offering it after a
              failed load would invite seeding types that may already exist.

              GA-096 asked for this control to be DELETED as a developer button that shipped by
              accident. It is not one, and deleting it would have been a regression: it calls
              `POST /api/v1/hr/leave/types/defaults`, a real endpoint gated on
              `hr.attendance.manage` and idempotent by design, and it is the ONLY way to create a
              leave type from inside the product — `POST /api/v1/hr/leave/types` has no frontend
              caller anywhere. Remove it and a new tenant can never request leave at all, because
              the request form's type dropdown would stay permanently empty.

              What was actually wrong is the LANGUAGE. "Seed" is developer vocabulary, and a bare
              ghost button carrying it, with no explanation, is exactly why a button inventory read
              it as leftover tooling. It now says what it does, in the words of the person who has
              to press it, and says why it is being offered. See 14b-01-SUMMARY.md §Corrections. */}
          {leaveTypesQuery.isSuccess && leaveTypes.length === 0 && (
            <PermissionGuard require="hr.attendance.manage">
              <div className="space-y-1 rounded-lg border border-dashed p-3">
                <p className="text-small text-muted-foreground">
                  No leave types exist yet, so nobody can request leave. Add the standard set
                  (annual, sick, casual) to get started — you can change them later.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ensureLeaveDefaults.isPending}
                  onClick={() =>
                    ensureLeaveDefaults.mutate(undefined, {
                      onError: () => toast.error("Couldn't add the standard leave types."),
                    })
                  }
                >
                  {ensureLeaveDefaults.isPending ? "Adding…" : "Add standard leave types"}
                </Button>
              </div>
            </PermissionGuard>
          )}
        </section>
      </div>

      {/* ── Quarantine ───────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="quarantine-heading" className="space-y-(--space-sm)">
        <div>
          <h2 id="quarantine-heading" className="text-h2 font-semibold">
            Attendance quarantine ({quarantine.length})
          </h2>
          <p className="text-small text-muted-foreground">
            Punches the device reported against a badge number this branch does not recognise. Map
            each one to a person and the mapping is remembered.
          </p>
        </div>

        {quarantineQuery.isError ? (
          <HrErrorNotice
            what="the quarantine queue"
            error={quarantineQuery.error}
            onRetry={() => void quarantineQuery.refetch()}
          />
        ) : (
          <DataGrid
            label="Quarantined punches"
            columns={quarantineColumns}
            data={quarantine}
            isLoading={quarantineQuery.isLoading}
            emptyTitle="No quarantined punches"
            emptyDescription="Every punch the device reported matched a badge number this branch knows."
            card={{
              primary: (q) => q.deviceUserRef,
              secondary: (q) => `${q.punchType ?? "—"} · ${q.deviceReportedAt}`,
            }}
          />
        )}
      </section>
    </PageBody>
  );
}

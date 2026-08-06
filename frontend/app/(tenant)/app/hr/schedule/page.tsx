"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { ShiftCalendar } from "@/components/hr/shift-calendar";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEmployees } from "@/lib/hooks/hr/use-employees";
import { useCreateShift } from "@/lib/hooks/hr/use-shifts";

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(iso: string, weeks: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export default function SchedulePage() {
  const employeesQuery = useEmployees();
  const createShift = useCreateShift();

  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [shiftForm, setShiftForm] = useState({
    name: "",
    roleDesignation: "",
    startTime: "09:00",
    endTime: "17:00",
    days: "1,2,3,4,5",
  });

  function submitShift() {
    createShift.mutate(
      {
        name: shiftForm.name,
        roleDesignation: shiftForm.roleDesignation || undefined,
        startTime:
          shiftForm.startTime.length === 5 ? shiftForm.startTime + ":00" : shiftForm.startTime,
        endTime: shiftForm.endTime.length === 5 ? shiftForm.endTime + ":00" : shiftForm.endTime,
        daysOfWeek: shiftForm.days
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n)),
      },
      {
        // No manual reload key any more — useCreateShift invalidates the shift keys, so the
        // calendar below re-fetches the week itself instead of being remounted from scratch.
        onSuccess: () => toast.success("Shift created"),
        onError: () => toast.error("Failed to create shift"),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Weekly schedule</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => shiftWeek(w, -1))}>
            ← Prev
          </Button>
          <span className="text-sm text-muted-foreground">week of {weekStart}</span>
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => shiftWeek(w, 1))}>
            Next →
          </Button>
        </div>
      </div>

      <PermissionGuard require="hr.attendance.manage" fallback={null}>
        <div className="flex flex-wrap items-end gap-2 rounded border p-3">
          <Input
            placeholder="Shift name"
            className="w-40"
            value={shiftForm.name}
            onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
          />
          <Input
            placeholder="Role"
            className="w-32"
            value={shiftForm.roleDesignation}
            onChange={(e) => setShiftForm({ ...shiftForm, roleDesignation: e.target.value })}
          />
          <Input
            type="time"
            value={shiftForm.startTime}
            onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
          />
          <Input
            type="time"
            value={shiftForm.endTime}
            onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
          />
          <Input
            placeholder="Days (1-7)"
            className="w-28"
            value={shiftForm.days}
            onChange={(e) => setShiftForm({ ...shiftForm, days: e.target.value })}
          />
          <Button size="sm" disabled={createShift.isPending} onClick={submitShift}>
            Add shift
          </Button>
        </div>
      </PermissionGuard>

      {/* The roster drives the drag rail. If it failed, say so — an empty rail otherwise
          reads as "this branch has no staff" and there is nothing to drag. */}
      {employeesQuery.isError && (
        <HrErrorNotice
          what="the employee roster"
          error={employeesQuery.error}
          onRetry={() => void employeesQuery.refetch()}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Drag an employee onto a shift/date cell to assign; drag an assigned chip between cells to
        move. Scoped to your active branch.
      </p>
      <ShiftCalendar employees={employeesQuery.data ?? []} weekStart={weekStart} />
    </div>
  );
}

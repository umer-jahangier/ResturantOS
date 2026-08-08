"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { ShiftCalendar } from "@/components/hr/shift-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HrRepository } from "@/lib/repositories/hr.repository";
import type { Employee } from "@/lib/models/hr.model";

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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [reloadKey, setReloadKey] = useState(0);
  const [shiftForm, setShiftForm] = useState({ name: "", roleDesignation: "", startTime: "09:00", endTime: "17:00", days: "1,2,3,4,5" });

  useEffect(() => {
    void HrRepository.listEmployees().then(setEmployees).catch(() => toast.error("Failed to load employees"));
  }, []);

  async function createShift() {
    try {
      await HrRepository.createShift({
        name: shiftForm.name,
        roleDesignation: shiftForm.roleDesignation || undefined,
        startTime: shiftForm.startTime.length === 5 ? shiftForm.startTime + ":00" : shiftForm.startTime,
        endTime: shiftForm.endTime.length === 5 ? shiftForm.endTime + ":00" : shiftForm.endTime,
        daysOfWeek: shiftForm.days.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
      });
      toast.success("Shift created");
      setReloadKey((k) => k + 1);
    } catch {
      toast.error("Failed to create shift");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Weekly schedule</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => shiftWeek(w, -1))}>← Prev</Button>
          <span className="text-sm text-muted-foreground">week of {weekStart}</span>
          <Button size="sm" variant="outline" onClick={() => setWeekStart((w) => shiftWeek(w, 1))}>Next →</Button>
        </div>
      </div>

      <PermissionGuard require="hr.attendance.manage" fallback={null}>
        <div className="flex flex-wrap items-end gap-2 rounded border p-3">
          <Input placeholder="Shift name" className="w-40" value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} />
          <Input placeholder="Role" className="w-32" value={shiftForm.roleDesignation} onChange={(e) => setShiftForm({ ...shiftForm, roleDesignation: e.target.value })} />
          <Input type="time" value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} />
          <Input type="time" value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} />
          <Input placeholder="Days (1-7)" className="w-28" value={shiftForm.days} onChange={(e) => setShiftForm({ ...shiftForm, days: e.target.value })} />
          <Button size="sm" onClick={createShift}>Add shift</Button>
        </div>
      </PermissionGuard>

      <p className="text-xs text-muted-foreground">Drag an employee onto a shift/date cell to assign; drag an assigned chip between cells to move. Scoped to your active branch.</p>
      <ShiftCalendar key={`${weekStart}-${reloadKey}`} employees={employees} weekStart={weekStart} />
    </div>
  );
}

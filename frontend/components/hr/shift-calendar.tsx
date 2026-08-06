"use client";

import { useCallback, useEffect, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { HrRepository } from "@/lib/repositories/hr.repository";
import type { Employee, WeekGrid } from "@/lib/models/hr.model";

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface DragPayload {
  employeeId: string;
  assignmentId?: string;
}

/**
 * HR-04 drag-and-drop weekly shift calendar. Employees (left rail) are dragged onto a shift×date
 * cell to assign; an assigned chip dragged to another cell moves (unassign+assign). Uses native
 * HTML5 drag events — no extra dependency (none is present in the frontend).
 */
export function ShiftCalendar({ employees, weekStart }: { employees: Employee[]; weekStart: string }) {
  const [grid, setGrid] = useState<WeekGrid | null>(null);

  const load = useCallback(async () => {
    try {
      setGrid(await HrRepository.weekGrid(weekStart));
    } catch {
      toast.error("Failed to load week");
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const empName = (id: string) => employees.find((e) => e.id === id)?.fullName ?? id.slice(0, 6);

  function startDrag(e: DragEvent, payload: DragPayload) {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDrop(e: DragEvent, shiftId: string, date: string) {
    e.preventDefault();
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
    } catch {
      return;
    }
    const promise = payload.assignmentId
      ? HrRepository.moveAssignment(payload.assignmentId, shiftId, date)
      : HrRepository.assign(shiftId, payload.employeeId, date);
    void promise.then(() => void load()).catch(() => toast.error("Assignment failed"));
  }

  if (!grid) return <p className="text-sm text-muted-foreground">Loading week…</p>;

  return (
    <div className="flex gap-4">
      <aside className="w-40 shrink-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Employees</p>
        {employees.map((e) => (
          <div
            key={e.id}
            draggable
            onDragStart={(ev) => startDrag(ev, { employeeId: e.id })}
            className="cursor-grab rounded border bg-muted px-2 py-1 text-xs"
          >
            {e.fullName}
          </div>
        ))}
        {employees.length === 0 && <p className="text-xs text-muted-foreground">No employees.</p>}
      </aside>

      <div className="grow overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border p-1 text-left">Shift</th>
              {days.map((d) => <th key={d} className="border p-1">{d.slice(5)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.shifts.map((shift) => (
              <tr key={shift.id}>
                <td className="border p-1 align-top">
                  <div className="font-medium">{shift.name}</div>
                  <div className="text-muted-foreground">{shift.startTime.slice(0, 5)}–{shift.endTime.slice(0, 5)}</div>
                </td>
                {days.map((date) => {
                  const cell = grid.assignments.filter((a) => a.shiftId === shift.id && a.workDate === date);
                  return (
                    <td
                      key={date}
                      onDragOver={(ev) => ev.preventDefault()}
                      onDrop={(ev) => onDrop(ev, shift.id, date)}
                      className="min-w-24 border p-1 align-top"
                    >
                      {cell.map((a) => (
                        <div
                          key={a.id}
                          draggable
                          onDragStart={(ev) => startDrag(ev, { employeeId: a.employeeId, assignmentId: a.id })}
                          className="mb-1 cursor-grab rounded bg-primary/10 px-1 py-0.5"
                        >
                          {empName(a.employeeId)}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {grid.shifts.length === 0 && (
              <tr><td colSpan={8} className="border p-3 text-center text-muted-foreground">No shifts — create one to start scheduling.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

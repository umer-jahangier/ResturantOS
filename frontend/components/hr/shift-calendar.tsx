"use client";

import { type DragEvent } from "react";
import { toast } from "sonner";

import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { useAssignShift, useMoveAssignment, useWeekGrid } from "@/lib/hooks/hr/use-shifts";
import type { Employee } from "@/lib/models/hr.model";

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
 *
 * <p>The week grid and both writes go through Layer-3 hooks; the component itself no longer knows
 * that a repository exists (FE-08 boundary). The mutations invalidate the shift keys, so the grid
 * re-fetches itself after a drop instead of the component re-running a hand-rolled `load()`.
 */
export function ShiftCalendar({
  employees,
  weekStart,
}: {
  employees: Employee[];
  weekStart: string;
}) {
  const { data: grid, isLoading, isError, error, refetch } = useWeekGrid(weekStart);
  const assignShift = useAssignShift();
  const moveAssignment = useMoveAssignment();

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
    const onError = { onError: () => toast.error("Assignment failed") };
    if (payload.assignmentId) {
      moveAssignment.mutate(
        { assignmentId: payload.assignmentId, newShiftId: shiftId, newWorkDate: date },
        onError,
      );
    } else {
      assignShift.mutate({ shiftId, employeeId: payload.employeeId, workDate: date }, onError);
    }
  }

  // A failed week must say so. Rendering the "No shifts — create one to start scheduling."
  // row instead would tell a manager the week is genuinely unscheduled and invite them to
  // rebuild a rota that already exists.
  if (isError) {
    return (
      <HrErrorNotice what="this week's schedule" error={error} onRetry={() => void refetch()} />
    );
  }

  if (isLoading || !grid) {
    return <p className="text-small text-muted-foreground">Loading week…</p>;
  }

  return (
    <div className="flex gap-4">
      <aside className="w-40 shrink-0 space-y-1">
        <p className="text-label font-medium text-muted-foreground">Employees</p>
        {employees.map((e) => (
          <div
            key={e.id}
            draggable
            onDragStart={(ev) => startDrag(ev, { employeeId: e.id })}
            className="cursor-grab rounded-md border bg-muted px-2 py-1 text-label"
          >
            {e.fullName}
          </div>
        ))}
        {employees.length === 0 && (
          <p className="text-label text-muted-foreground">No employees.</p>
        )}
      </aside>

      <div className="relative grow overflow-x-auto">
        <table className="w-full border-collapse text-label">
          <thead>
            <tr>
              <th className="border p-1 text-left">Shift</th>
              {days.map((d) => (
                <th key={d} className="border p-1">
                  {d.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.shifts.map((shift) => (
              <tr key={shift.id}>
                <td className="border p-1 align-top">
                  <div className="font-medium">{shift.name}</div>
                  <div className="text-muted-foreground">
                    {shift.startTime.slice(0, 5)}–{shift.endTime.slice(0, 5)}
                  </div>
                </td>
                {days.map((date) => {
                  const cell = grid.assignments.filter(
                    (a) => a.shiftId === shift.id && a.workDate === date,
                  );
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
                          onDragStart={(ev) =>
                            startDrag(ev, { employeeId: a.employeeId, assignmentId: a.id })
                          }
                          className="mb-1 cursor-grab rounded-md bg-primary/10 px-1 py-0.5"
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
              <tr>
                <td colSpan={8} className="border p-3 text-center text-muted-foreground">
                  No shifts — create one to start scheduling.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

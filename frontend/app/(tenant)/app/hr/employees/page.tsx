"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCreateEmployee,
  useDeactivateEmployee,
  useEmployees,
} from "@/lib/hooks/hr/use-employees";
import type { EmploymentType } from "@/lib/models/hr.model";

const EMPLOYMENT_TYPES: EmploymentType[] = ["PERMANENT", "PART_TIME", "DAILY_WAGE", "CONTRACT"];

function rupees(paisa: number): string {
  return `₨ ${(paisa / 100).toLocaleString()}`;
}

export default function EmployeesPage() {
  const { data: employees, isLoading, isError, error, refetch } = useEmployees();
  const createEmployee = useCreateEmployee();
  const deactivateEmployee = useDeactivateEmployee();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeNo: "",
    fullName: "",
    cnic: "",
    bankAccountNo: "",
    designation: "",
    employmentType: "PERMANENT" as EmploymentType,
    joinDate: new Date().toISOString().slice(0, 10),
    basicSalaryRupees: "0",
    deviceUserRef: "",
  });

  function create() {
    createEmployee.mutate(
      {
        employeeNo: form.employeeNo,
        fullName: form.fullName,
        cnic: form.cnic || undefined,
        bankAccountNo: form.bankAccountNo || undefined,
        designation: form.designation || undefined,
        employmentType: form.employmentType,
        joinDate: form.joinDate,
        basicSalaryPaisa: Math.round(Number(form.basicSalaryRupees) * 100),
        deviceUserRef: form.deviceUserRef || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Employee created");
          setShowForm(false);
        },
        onError: () => toast.error("Failed to create employee"),
      },
    );
  }

  function deactivate(id: string) {
    deactivateEmployee.mutate(id, {
      onSuccess: () => toast.success("Employee deactivated"),
      onError: () => toast.error("Failed to deactivate"),
    });
  }

  const rows = employees ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Employees</h1>
        <PermissionGuard require="hr.employee.manage" fallback={null}>
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "New employee"}
          </Button>
        </PermissionGuard>
      </div>

      {showForm && (
        <div className="grid grid-cols-2 gap-2 rounded border p-3">
          <Input
            placeholder="Employee no"
            value={form.employeeNo}
            onChange={(e) => setForm({ ...form, employeeNo: e.target.value })}
          />
          <Input
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <Input
            placeholder="CNIC"
            value={form.cnic}
            onChange={(e) => setForm({ ...form, cnic: e.target.value })}
          />
          <Input
            placeholder="Bank account"
            value={form.bankAccountNo}
            onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
          />
          <Input
            placeholder="Designation"
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
          />
          <select
            className="rounded border px-2 text-sm"
            value={form.employmentType}
            onChange={(e) => setForm({ ...form, employmentType: e.target.value as EmploymentType })}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Input
            type="date"
            value={form.joinDate}
            onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
          />
          <Input
            type="number"
            placeholder="Basic salary (₨)"
            value={form.basicSalaryRupees}
            onChange={(e) => setForm({ ...form, basicSalaryRupees: e.target.value })}
          />
          <Input
            placeholder="Device PIN (optional)"
            value={form.deviceUserRef}
            onChange={(e) => setForm({ ...form, deviceUserRef: e.target.value })}
          />
          <Button onClick={create} disabled={createEmployee.isPending}>
            {createEmployee.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      )}

      {/* A failed load must never fall through to the "No employees yet." row — that would
          read as an empty roster and invite someone to re-enter the whole thing. */}
      {isError ? (
        <HrErrorNotice what="the employee roster" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">No</th>
              <th>Name</th>
              <th>Designation</th>
              <th>CNIC</th>
              <th>Bank</th>
              <th>Basic</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="py-2">{e.employeeNo}</td>
                <td>{e.fullName}</td>
                <td>{e.designation ?? "—"}</td>
                <td>{e.cnicMasked ?? "—"}</td>
                <td>{e.bankAccountMasked ?? "—"}</td>
                <td>{rupees(e.basicSalaryPaisa)}</td>
                <td>{e.active ? "Active" : "Inactive"}</td>
                <td className="text-right">
                  {e.active && (
                    <PermissionGuard require="hr.employee.manage" fallback={null}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deactivateEmployee.isPending}
                        onClick={() => deactivate(e.id)}
                      >
                        Deactivate
                      </Button>
                    </PermissionGuard>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-muted-foreground">
                  No employees yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

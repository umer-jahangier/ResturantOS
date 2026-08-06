"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HrRepository } from "@/lib/repositories/hr.repository";
import type { Employee, EmploymentType } from "@/lib/models/hr.model";

const EMPLOYMENT_TYPES: EmploymentType[] = ["PERMANENT", "PART_TIME", "DAILY_WAGE", "CONTRACT"];

function rupees(paisa: number): string {
  return `₨ ${(paisa / 100).toLocaleString()}`;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function load() {
    setLoading(true);
    try {
      setEmployees(await HrRepository.listEmployees());
    } catch {
      toast.error("Failed to load employees");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    try {
      await HrRepository.createEmployee({
        employeeNo: form.employeeNo,
        fullName: form.fullName,
        cnic: form.cnic || undefined,
        bankAccountNo: form.bankAccountNo || undefined,
        designation: form.designation || undefined,
        employmentType: form.employmentType,
        joinDate: form.joinDate,
        basicSalaryPaisa: Math.round(Number(form.basicSalaryRupees) * 100),
        deviceUserRef: form.deviceUserRef || undefined,
      });
      toast.success("Employee created");
      setShowForm(false);
      await load();
    } catch {
      toast.error("Failed to create employee");
    }
  }

  async function deactivate(id: string) {
    try {
      await HrRepository.deactivateEmployee(id);
      toast.success("Employee deactivated");
      await load();
    } catch {
      toast.error("Failed to deactivate");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Employees</h1>
        <PermissionGuard require="hr.employee.manage" fallback={null}>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New employee"}</Button>
        </PermissionGuard>
      </div>

      {showForm && (
        <div className="grid grid-cols-2 gap-2 rounded border p-3">
          <Input placeholder="Employee no" value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} />
          <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input placeholder="CNIC" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
          <Input placeholder="Bank account" value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} />
          <Input placeholder="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <select
            className="rounded border px-2 text-sm"
            value={form.employmentType}
            onChange={(e) => setForm({ ...form, employmentType: e.target.value as EmploymentType })}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
          <Input type="number" placeholder="Basic salary (₨)" value={form.basicSalaryRupees} onChange={(e) => setForm({ ...form, basicSalaryRupees: e.target.value })} />
          <Input placeholder="Device PIN (optional)" value={form.deviceUserRef} onChange={(e) => setForm({ ...form, deviceUserRef: e.target.value })} />
          <Button onClick={create}>Create</Button>
        </div>
      )}

      {loading ? (
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
            {employees.map((e) => (
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
                      <Button variant="ghost" size="sm" onClick={() => deactivate(e.id)}>Deactivate</Button>
                    </PermissionGuard>
                  )}
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">No employees yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

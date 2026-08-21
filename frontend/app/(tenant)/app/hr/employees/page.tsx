"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmployeeFormDialog } from "@/components/hr/employee-form-dialog";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Select } from "@/components/ui/select";
import { useDepartments } from "@/lib/hooks/hr/use-hr-config";
import { useDeactivateEmployee, useEmployees } from "@/lib/hooks/hr/use-employees";
import type { Employee } from "@/lib/models/hr.model";

// GA-078: HR formatted money itself — `₨ ${(paisa / 100).toLocaleString()}` — instead of going
// through `MoneyDisplay`. Two consequences, both visible in a payroll column: the symbol was `₨`
// where the rest of the product uses `Rs`, and `toLocaleString()` drops trailing zeros, so
// 250000 paisa rendered "₨ 2,500" and 250050 rendered "₨ 2,500.5". Decimal points stopped
// aligning down a salary column — the one place in a product where a misread digit costs money.
// `lib/adapters/shared.ts:1-2` states the rule: money is integer paisa and is NEVER divided by
// 100 in a component. Every HR amount renders through the shared component.

/**
 * The employee roster.
 *
 * <p>The form that used to live inline here — nine unlabelled placeholder inputs in a grid, one
 * `useState` object, no validation, and a single fixed failure toast — is now
 * {@link EmployeeFormDialog}, built on the app form standard. This file is the list: search,
 * filter, and the two actions.
 *
 * <p>The Department column is new. It existed in the API and the database and was not on this
 * screen at all, which is why nobody noticed it had become three spellings of "Waiter".
 */
export default function EmployeesPage() {
  const { data: employees, isLoading, isError, error, refetch } = useEmployees();
  const departments = useDepartments();
  const deactivateEmployee = useDeactivateEmployee();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (employees ?? []).filter((e) => {
      if (!showInactive && !e.active) return false;
      if (departmentFilter && e.departmentId !== departmentFilter) return false;
      if (!term) return true;
      return e.fullName.toLowerCase().includes(term) || e.employeeNo.toLowerCase().includes(term);
    });
  }, [employees, search, departmentFilter, showInactive]);

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(employee: Employee) {
    setEditing(employee);
    setDialogOpen(true);
  }

  function deactivate(employee: Employee) {
    deactivateEmployee.mutate(employee.id, {
      onSuccess: () => toast.success(`${employee.fullName} deactivated`),
      onError: () => toast.error(`Could not deactivate ${employee.fullName}`),
    });
  }

  const total = employees?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Employees</h1>
        <PermissionGuard require="hr.employee.manage" fallback={null}>
          <Button onClick={openCreate}>New employee</Button>
        </PermissionGuard>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-64"
          placeholder="Search by name or number"
          aria-label="Search employees"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="w-56">
          <Select
            aria-label="Filter by department"
            options={[
              { value: "", label: "All departments" },
              ...(departments.data ?? [])
                .filter((d) => d.active)
                .map((d) => ({ value: d.id, label: d.name })),
            ]}
            value={departmentFilter}
            onValueChange={setDepartmentFilter}
            isLoading={departments.isPending}
            error={departments.isError}
            onRetry={() => void departments.refetch()}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show former staff
        </label>
        <span className="text-muted-foreground ml-auto text-sm">
          {rows.length} of {total}
        </span>
      </div>

      {/* A failed load must never fall through to the "No employees yet." row — that would
          read as an empty roster and invite someone to re-enter the whole thing. */}
      {isError ? (
        <HrErrorNotice what="the employee roster" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-2">No</th>
              <th>Name</th>
              <th>Department</th>
              <th>Job title</th>
              <th>CNIC</th>
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
                <td>{e.departmentName ?? "—"}</td>
                <td>{e.designationName ?? "—"}</td>
                <td>{e.cnicMasked ?? "—"}</td>
                <td>
                  <MoneyDisplay paisa={e.basicSalaryPaisa} />
                </td>
                <td>{e.active ? "Active" : "Former"}</td>
                <td className="space-x-1 text-right">
                  <PermissionGuard require="hr.employee.manage" fallback={null}>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>
                      Edit
                    </Button>
                    {e.active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deactivateEmployee.isPending}
                        onClick={() => deactivate(e)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </PermissionGuard>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted-foreground py-4 text-center">
                  {total === 0 ? "No employees yet." : "No employee matches this search or filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <PermissionGuard require="hr.employee.manage" fallback={null}>
        <EmployeeFormDialog
          employee={editing}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(undefined);
          }}
        />
      </PermissionGuard>
    </div>
  );
}

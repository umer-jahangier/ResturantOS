"use client";

import { useMemo, useState } from "react";
import { Building2, UserRound, UserRoundCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

import { EmployeeFormDialog } from "@/components/hr/employee-form-dialog";
import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import { countLine, filteredCountLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
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
 * <p>The Department column existed in the API and the database and was not on this screen at all,
 * which is why nobody noticed it had become three spellings of "Waiter".
 *
 * <h3>38-08: deactivation asks first</h3>
 *
 * `deactivate()` fired straight from the row button. Deactivating a person removes their ability
 * to sign in and drops them out of every roster and rota this product draws — an
 * `hr.employee.manage` holder was one mis-click on a dense list away from doing that to the wrong
 * name, with only a toast afterwards. It now goes through the shared {@link ConfirmDialog}, whose
 * confirm button restates the verb and whose body names the consequence, and the employee's own
 * name is in the title so the dialog cannot be dismissed on autopilot.
 */
export default function EmployeesPage() {
  const { data: employees, isLoading, isError, error, refetch } = useEmployees();
  const departments = useDepartments();
  const deactivateEmployee = useDeactivateEmployee();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | undefined>(undefined);
  const [confirming, setConfirming] = useState<Employee | null>(null);
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
      onSuccess: () => {
        setConfirming(null);
        toast.success(`${employee.fullName} deactivated`);
      },
      onError: () => toast.error(`Could not deactivate ${employee.fullName}`),
    });
  }

  const total = employees?.length ?? 0;

  /*
   * Computed off `employees` — the whole roster the hook returned, which is also what `rows`
   * filters — so the strip states the branch and the subtitle states how much of it survived the
   * filters. `payrollPaisa` sums ACTIVE employees only: a deactivated leaver's basic salary is
   * still on their record and adding it to a monthly wage bill would overstate it by however many
   * people have ever left.
   */
  const roster = employees ?? [];
  const activeCount = roster.filter((e) => e.active).length;
  const departmentCount = new Set(
    roster.filter((e) => e.departmentId !== null).map((e) => e.departmentId),
  ).size;
  const undepartmented = roster.filter((e) => e.departmentId === null).length;
  const payrollPaisa = roster.reduce((sum, e) => (e.active ? sum + e.basicSalaryPaisa : sum), 0);

  const columns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      {
        id: "employeeNo",
        accessorKey: "employeeNo",
        header: "No",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.employeeNo}</span>
        ),
      },
      {
        id: "fullName",
        accessorKey: "fullName",
        header: "Name",
        cell: ({ row }) => (
          <span className="flex items-center gap-(--space-sm)">
            <Avatar name={row.original.fullName} toneKey={row.original.id} size="sm" />
            <span className="font-medium">{row.original.fullName}</span>
          </span>
        ),
      },
      {
        id: "departmentName",
        accessorKey: "departmentName",
        header: "Department",
        cell: ({ row }) => row.original.departmentName ?? "—",
      },
      {
        id: "designationName",
        accessorKey: "designationName",
        header: "Job title",
        cell: ({ row }) => row.original.designationName ?? "—",
      },
      {
        id: "cnicMasked",
        accessorKey: "cnicMasked",
        header: "CNIC",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.cnicMasked ?? "—"}</span>
        ),
      },
      {
        id: "basicSalaryPaisa",
        accessorKey: "basicSalaryPaisa",
        header: "Basic",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.basicSalaryPaisa} />
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "active",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.active ? "active" : "inactive"}
            label={row.original.active ? "Active" : "Former"}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <PermissionGuard require="hr.employee.manage" fallback={null}>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>
                Edit
              </Button>
              {row.original.active && (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(row.original)}>
                  Deactivate
                </Button>
              )}
            </div>
          </PermissionGuard>
        ),
      },
    ],
    [],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Employees"
        description="Everyone on the payroll for this branch."
        /*
         * `${rows.length} of ${total} shown` was the whole subtitle: true, and it says nothing a
         * person came to this screen to learn. The `·` line now reconciles with the grid AND with
         * the strip below it — shown/total is the grid, active is the first tile, and the
         * department count is the third.
         */
        meta={statLine(
          filteredCountLine(rows.length, total, "employee"),
          `${formatNumber(activeCount)} active`,
          departmentCount > 0 ? countLine(departmentCount, "department") : undefined,
          undepartmented > 0 ? `${formatNumber(undepartmented)} unassigned` : undefined,
        )}
        actions={
          <PermissionGuard require="hr.employee.manage" fallback={null}>
            <Button onClick={openCreate}>New employee</Button>
          </PermissionGuard>
        }
      />

      <div className="grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="On the roster"
          value={formatNumber(total)}
          icon={UserRound}
          accent="primary"
        />
        <StatTile
          label="Active"
          value={formatNumber(activeCount)}
          icon={UserRoundCheck}
          accent="secondary"
        />
        <StatTile
          label="Departments represented"
          value={formatNumber(departmentCount)}
          icon={Building2}
        />
        <StatTile
          label="Basic salary, active staff"
          value={<MoneyDisplay paisa={payrollPaisa} />}
          icon={Wallet}
        />
      </div>

      <FilterBar
        title="Roster"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search employees by name or number",
          placeholder: "Search by name or number",
        }}
        filters={[
          {
            id: "department",
            label: "Department",
            value: departmentFilter,
            allLabel: "All departments",
            onChange: setDepartmentFilter,
            isLoading: departments.isPending,
            error: departments.isError,
            onRetry: () => void departments.refetch(),
            options: (departments.data ?? [])
              .filter((d) => d.active)
              .map((d) => ({ value: d.id, label: d.name })),
          },
        ]}
        extraActiveCount={showInactive ? 1 : 0}
        onClearAll={() => {
          setSearch("");
          setDepartmentFilter("");
          setShowInactive(false);
        }}
      >
        <label className="flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4 rounded-sm border-border-interactive"
          />
          Show former staff
        </label>
      </FilterBar>

      {/* A failed load must never fall through to the "No employees yet." row — that would
          read as an empty roster and invite someone to re-enter the whole thing. */}
      {isError ? (
        <HrErrorNotice what="the employee roster" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : (
        <DataGrid
          label="Employees"
          columns={columns}
          data={rows}
          isFiltered={search.trim() !== "" || departmentFilter !== "" || showInactive}
          onClearFilters={() => {
            setSearch("");
            setDepartmentFilter("");
            setShowInactive(false);
          }}
          emptyTitle={total === 0 ? "No employees yet" : "No employee matches this search"}
          emptyDescription={
            total === 0
              ? "Add the people who work here so they appear on rotas and payroll."
              : undefined
          }
          card={{
            primary: (e) => e.fullName,
            secondary: (e) => `${e.employeeNo} · ${e.designationName ?? "No job title"}`,
            trailing: (e) => <MoneyDisplay paisa={e.basicSalaryPaisa} />,
          }}
        />
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
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={confirming ? `Deactivate ${confirming.fullName}?` : "Deactivate employee?"}
          body="They stop appearing on rotas and payroll runs from now on. Records already posted are unchanged, and the account can be reactivated."
          confirmLabel="Deactivate"
          pendingLabel="Deactivating…"
          isPending={deactivateEmployee.isPending}
          onConfirm={() => confirming && deactivate(confirming)}
        />
      </PermissionGuard>
    </PageBody>
  );
}

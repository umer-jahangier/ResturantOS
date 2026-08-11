"use client";

import * as React from "react";

import { Combobox } from "@/components/ui/combobox";
import { Select, type SelectOption } from "@/components/ui/select";
import { useDepartments, useDesignations } from "@/lib/hooks/hr/use-hr-config";
import { useEmployees } from "@/lib/hooks/hr/use-employees";
import { EMPLOYMENT_TYPE_VALUES, type EmploymentType } from "@/lib/models/hr.model";

/**
 * The HR closed-set pickers — one component per field, for the whole product (D-35-01).
 *
 * <h2>The rule these exist to enforce</h2>
 *
 * *Anything with a known set of values is a select, not a text field.* Typing a department by hand
 * is what produced "Waiter", "waiter" and "Wtr" as three departments that no report could group —
 * the user's own complaint. So every one of these takes its options from a single source: a query
 * where the set is tenant-managed, and the Layer-1 Zod enum where the set is a fixed protocol value.
 *
 * <h2>Why a literal array does not appear anywhere below</h2>
 *
 * `EMPLOYMENT_TYPES` was a hand-written array in `employees/page.tsx`. A second screen wanting the
 * same dropdown copies it, the two drift, and one screen offers a value the API rejects. The list
 * is derived from `employmentTypeSchema.options`, so adding a case to the schema adds it here and
 * removing one removes it here — the compiler and the API cannot disagree.
 *
 * <h2>Three states, not two</h2>
 *
 * Pending, failed, and loaded. `Select` renders a failed load as an error with a retry rather than
 * as an empty menu, because an empty menu says "there are none" — a different and far more damaging
 * statement than "this did not load", and one that on day one is *also* true, which is exactly why
 * the two must look different. Each picker forwards `isLoading` / `error` / `onRetry` through.
 *
 * <h2>Inactive rows are shown, disabled, not hidden</h2>
 *
 * A department is deactivated, never deleted (35-05), so an employee assigned to it before it was
 * retired still resolves. Hiding it from the picker would make editing that employee silently drop
 * their department; showing it disabled, and enabled only when it is the value already selected,
 * keeps the record intact while refusing it as a NEW choice.
 */

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT: "Permanent",
  PART_TIME: "Part time",
  DAILY_WAGE: "Daily wage",
  CONTRACT: "Contract",
};

export interface OptionSelectProps {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  onBlur?: React.FocusEventHandler<HTMLSelectElement>;
}

/**
 * Turn a tenant-managed list into options, keeping an inactive row selectable only when it is
 * already the answer. See the module comment for why it is not simply filtered out.
 */
function toOptions(
  rows: readonly { id: string; name: string; active: boolean }[] | undefined,
  selected: string | null | undefined,
): SelectOption[] {
  return (rows ?? [])
    .filter((r) => r.active || r.id === selected)
    .map((r) => ({
      value: r.id,
      label: r.active ? r.name : `${r.name} (retired)`,
      disabled: !r.active && r.id !== selected,
    }));
}

export function DepartmentSelect({ value, onValueChange, ...rest }: OptionSelectProps) {
  const { data, isPending, isError, refetch } = useDepartments();
  return (
    <Select
      options={toOptions(data, value)}
      value={value ?? ""}
      onValueChange={onValueChange}
      placeholder="Choose a department"
      emptyLabel="No departments yet — add one in HR settings"
      isLoading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      {...rest}
    />
  );
}

/**
 * @param departmentId when set, only designations under that department (plus ungrouped ones) are
 *   offered. A designation's parent is optional by design — requiring one would force an owner to
 *   invent a department before naming a single job title — so an ungrouped designation stays
 *   available whatever department is chosen, rather than disappearing when one is.
 */
export function DesignationSelect({
  value,
  onValueChange,
  departmentId,
  ...rest
}: OptionSelectProps & { departmentId?: string | null }) {
  const { data, isPending, isError, refetch } = useDesignations();

  const scoped = React.useMemo(() => {
    if (!departmentId) return data;
    return (data ?? []).filter(
      (d) => d.departmentId === departmentId || d.departmentId == null || d.id === value,
    );
  }, [data, departmentId, value]);

  return (
    <Select
      options={toOptions(scoped, value)}
      value={value ?? ""}
      onValueChange={onValueChange}
      placeholder="Choose a job title"
      emptyLabel="No job titles yet — add one in HR settings"
      isLoading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      {...rest}
    />
  );
}

/**
 * A fixed protocol enum, so there is no query and no loading state — but still one component, so
 * that the four labels are written once and a fifth employment type cannot be half-added.
 */
export function EmploymentTypeSelect({ value, onValueChange, ...rest }: OptionSelectProps) {
  return (
    <Select
      options={EMPLOYMENT_TYPE_VALUES.map((v) => ({ value: v, label: EMPLOYMENT_TYPE_LABELS[v] }))}
      value={value ?? ""}
      onValueChange={onValueChange}
      placeholder="Choose an employment type"
      {...rest}
    />
  );
}

/**
 * A searchable picker, because a roster is the one HR set that gets long.
 *
 * <p>The label carries the employee NUMBER as well as the name: two people called Muhammad Ali is
 * not a hypothetical in a Pakistani restaurant, and a picker that cannot tell them apart is worse
 * than a text field, because at least a text field admits it does not know.
 */
export function EmployeeCombobox({
  value,
  onValueChange,
  placeholder = "Choose an employee",
  includeInactive = false,
  ...rest
}: {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  includeInactive?: boolean;
  id?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const { data, isPending, isError, refetch } = useEmployees();

  const options = React.useMemo<SelectOption[]>(
    () =>
      (data ?? [])
        .filter((e) => includeInactive || e.active || e.id === value)
        .map((e) => ({
          value: e.id,
          label: `${e.fullName} · ${e.employeeNo}`,
          disabled: !e.active && e.id !== value,
        })),
    [data, includeInactive, value],
  );

  return (
    <Combobox
      options={options}
      value={value ?? ""}
      onValueChange={onValueChange}
      placeholder={placeholder}
      emptyLabel="No employees yet"
      isLoading={isPending}
      error={isError}
      onRetry={() => void refetch()}
      {...rest}
    />
  );
}

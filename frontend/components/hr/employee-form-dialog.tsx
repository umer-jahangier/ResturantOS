"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  DepartmentSelect,
  DesignationSelect,
  EmploymentTypeSelect,
} from "@/components/hr/option-selects";
import {
  EMPLOYEE_FORM_HINTS,
  employeeFormSchema,
  paisaToRupeesInput,
  rupeesToPaisa,
  type EmployeeFormValues,
} from "@/components/hr/employee-form-schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormHint,
  FormItem,
  FormLabel,
  FormMessage,
  FormSubmitButton,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { applyServerFieldErrors, useStandardForm } from "@/lib/forms";
import { useCreateEmployee, useUpdateEmployee } from "@/lib/hooks/hr/use-employees";
import type { Employee } from "@/lib/models/hr.model";

/**
 * Create and edit an employee — the screen the user's complaint was actually about.
 *
 * <h2>What this replaces</h2>
 *
 * Nine `<Input placeholder="…">` elements in a two-column grid, held in one `useState` object,
 * **with no labels at all** — the placeholder was the label, and it disappeared the moment anyone
 * typed. Designation was free text. Department was not on the form at all, despite existing in the
 * API and the database. There was no validation of any kind before submit, and the failure handler
 * was one line: `onError: () => toast.error("Failed to create employee")` — so a duplicate employee
 * number, an invalid date and a server outage were indistinguishable to the person who had just
 * typed nine fields. There was no edit path at all, only create and deactivate, although the API
 * has had an update endpoint since phase 11.
 *
 * <h2>The three things that are different</h2>
 *
 * 1. **Every closed set is a select** (D-35-01) — department, job title and employment type, all
 *    from `option-selects.tsx`, all from one source. Free text survives only where the value
 *    genuinely is free: a name, a CNIC, an account number, a device PIN.
 * 2. **Rules are stated before they are broken and checked as the user works** (D-35-02) —
 *    `useStandardForm` validates on blur and re-validates on every keystroke after that;
 *    `FormHint` shows the rule under an empty field; the submit button is disabled with the reason
 *    named in text associated to it.
 * 3. **A server rejection lands on the field it names** (D-35-03) — `applyServerFieldErrors` binds
 *    `409 DUPLICATE_VALUE` on `employeeNo` and `422 DEPARTMENT_NOT_FOUND` on `departmentId` to the
 *    inputs, and focuses the first one. Only a failure with no field path falls back to a toast.
 *
 * <h2>Masked PII is never submitted back</h2>
 *
 * The API returns `cnicMasked` / `bankAccountMasked` — literally `*******1234`. Preloading those
 * into the edit form and submitting them would overwrite the real, encrypted values with their own
 * masks, destroying the data while looking like a successful save. So both fields start EMPTY on
 * edit, with the mask shown as a hint beside them, and an empty value means "leave it as it is".
 */
export function EmployeeFormDialog({
  employee,
  open,
  onOpenChange,
}: {
  /** Present → edit that employee. Absent → create a new one. */
  employee?: Employee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const isEdit = employee !== undefined;

  const form = useStandardForm<EmployeeFormValues>({
    schema: employeeFormSchema,
    defaultValues: defaultsFor(employee),
  });

  // Re-seed when the dialog opens on a different employee. Without this, opening Edit on a second
  // person shows the first person's values — the dialog is mounted once and reused.
  const { reset } = form;
  React.useEffect(() => {
    if (open) reset(defaultsFor(employee));
  }, [open, employee, reset]);

  const departmentId = form.watch("departmentId");

  function onSubmit(values: EmployeeFormValues) {
    const shared = {
      fullName: values.fullName,
      // "" means "unchanged" on edit and "none" on create; in both cases the field is omitted
      // rather than sent as an empty string, which the server would store as a real blank value.
      cnic: values.cnic || undefined,
      bankAccountNo: values.bankAccountNo || undefined,
      departmentId: values.departmentId || undefined,
      designationId: values.designationId || undefined,
      employmentType: values.employmentType,
      basicSalaryPaisa: rupeesToPaisa(values.basicSalaryRupees),
      deviceUserRef: values.deviceUserRef || undefined,
    };

    const onError = (error: unknown) => {
      const applied = applyServerFieldErrors(form, error);
      // A toast ONLY when nothing could be bound. A refusal that named a field is now sitting on
      // that field with the input focused; a toast on top of it would be a second, vaguer copy of
      // a message the user is already looking at.
      if (!applied.hasFieldErrors) {
        toast.error(form.formState.errors.root?.message ?? "Could not save this employee");
      }
    };

    if (isEdit) {
      updateEmployee.mutate(
        { id: employee.id, input: shared },
        {
          onSuccess: () => {
            toast.success(`${values.fullName} updated`);
            onOpenChange(false);
          },
          onError,
        },
      );
      return;
    }

    createEmployee.mutate(
      { ...shared, employeeNo: values.employeeNo, joinDate: values.joinDate },
      {
        onSuccess: () => {
          toast.success(`${values.fullName} added`);
          onOpenChange(false);
        },
        onError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${employee.fullName}` : "New employee"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "The employee number and join date are fixed once an employee exists — payroll periods and attendance records are keyed to them."
              : "Everything with a list to choose from is a list. If a department or job title is missing, add it in HR settings."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="employeeNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee number</FormLabel>
                  <FormHint>{EMPLOYEE_FORM_HINTS.employeeNo}</FormHint>
                  <FormControl>
                    {/* Read-only rather than hidden on edit: someone looking for it should find
                        it and see why it cannot change, not conclude the screen forgot it. */}
                    <Input {...field} readOnly={isEdit} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="departmentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <FormControl>
                    <DepartmentSelect
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Changing department can put the chosen job title out of scope. Clearing
                        // it is honest; leaving a title from another department selected is how a
                        // record ends up internally inconsistent without anyone being told.
                        const current = form.getValues("designationId");
                        if (current) form.setValue("designationId", "", { shouldValidate: true });
                      }}
                      onBlur={field.onBlur}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="designationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job title</FormLabel>
                  <FormControl>
                    <DesignationSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      departmentId={departmentId || null}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="employmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employment type</FormLabel>
                  <FormControl>
                    <EmploymentTypeSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="joinDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Join date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} readOnly={isEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="basicSalaryRupees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Basic salary</FormLabel>
                  <FormHint>{EMPLOYEE_FORM_HINTS.basicSalaryRupees}</FormHint>
                  <FormControl>
                    <Input inputMode="decimal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deviceUserRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device PIN</FormLabel>
                  <FormHint>{EMPLOYEE_FORM_HINTS.deviceUserRef}</FormHint>
                  <FormControl>
                    <Input inputMode="numeric" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cnic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CNIC</FormLabel>
                  <FormHint>
                    {isEdit && employee.cnicMasked
                      ? `Currently ${employee.cnicMasked} — leave blank to keep it`
                      : EMPLOYEE_FORM_HINTS.cnic}
                  </FormHint>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bankAccountNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank account</FormLabel>
                  <FormHint>
                    {isEdit && employee.bankAccountMasked
                      ? `Currently ${employee.bankAccountMasked} — leave blank to keep it`
                      : EMPLOYEE_FORM_HINTS.bankAccountNo}
                  </FormHint>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root ? (
              <p role="alert" className="text-destructive md:col-span-2 text-small">
                {form.formState.errors.root.message}
              </p>
            ) : null}

            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <FormSubmitButton submitState={form.submitState}>
                {isEdit ? "Save changes" : "Add employee"}
              </FormSubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function defaultsFor(employee: Employee | undefined): EmployeeFormValues {
  if (!employee) {
    return {
      employeeNo: "",
      fullName: "",
      cnic: "",
      bankAccountNo: "",
      departmentId: "",
      designationId: "",
      employmentType: "PERMANENT",
      joinDate: new Date().toISOString().slice(0, 10),
      basicSalaryRupees: "",
      deviceUserRef: "",
    };
  }
  return {
    employeeNo: employee.employeeNo,
    fullName: employee.fullName,
    // Deliberately EMPTY, not the mask. See the class comment: submitting "*******1234" back would
    // overwrite the real encrypted value with its own mask and look like a successful save.
    cnic: "",
    bankAccountNo: "",
    departmentId: employee.departmentId ?? "",
    designationId: employee.designationId ?? "",
    employmentType: employee.employmentType,
    joinDate: employee.joinDate,
    basicSalaryRupees: paisaToRupeesInput(employee.basicSalaryPaisa),
    deviceUserRef: employee.deviceUserRef ?? "",
  };
}

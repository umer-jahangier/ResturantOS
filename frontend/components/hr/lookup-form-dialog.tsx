"use client";

import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DepartmentSelect } from "@/components/hr/option-selects";
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
import {
  useCreateDepartment,
  useCreateDesignation,
  useRenameDepartment,
  useRenameDesignation,
} from "@/lib/hooks/hr/use-hr-config";
import type { Department, Designation } from "@/lib/models/hr.model";

/**
 * Create and rename a department or a job title.
 *
 * <h2>The one server error this form exists to render properly</h2>
 *
 * The database enforces uniqueness on `lower(trim(name))` through a functional index (35-02), so
 * "Waiter", "waiter" and "  Waiter  " cannot coexist — and `HrConfigService` turns the collision
 * into a `409 DUPLICATE_VALUE` naming the `name` field, quoting the spelling that already exists.
 * That message is the entire point: it tells the owner *which* existing row they have collided with,
 * which a bare 409 cannot. `applyServerFieldErrors` puts it on the name input.
 *
 * <h2>There is no delete, here or in the API</h2>
 *
 * A department referenced by an employee cannot be removed without orphaning them or silently
 * rewriting their record. The list screen deactivates instead; the row stays resolvable so an
 * existing employee still renders with a real department name, and stops being offered as a choice.
 */

const lookupFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give it a name people will recognise")
    .max(80, "A name is at most 80 characters"),
  code: z.string().trim().max(20, "A code is at most 20 characters"),
  /** Empty means "not grouped under any department" — deliberately allowed. */
  departmentId: z.string(),
});

type LookupFormValues = z.infer<typeof lookupFormSchema>;

export function LookupFormDialog({
  kind,
  row,
  open,
  onOpenChange,
}: {
  kind: "department" | "designation";
  /** Present → rename that row. Absent → create a new one. */
  row?: Department | Designation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createDepartment = useCreateDepartment();
  const renameDepartment = useRenameDepartment();
  const createDesignation = useCreateDesignation();
  const renameDesignation = useRenameDesignation();

  const isDesignation = kind === "designation";
  const isEdit = row !== undefined;
  const noun = isDesignation ? "job title" : "department";

  const form = useStandardForm<LookupFormValues>({
    schema: lookupFormSchema,
    defaultValues: defaultsFor(row),
  });

  const { reset } = form;
  React.useEffect(() => {
    if (open) reset(defaultsFor(row));
  }, [open, row, reset]);

  function onSubmit(values: LookupFormValues) {
    const onError = (error: unknown) => {
      const applied = applyServerFieldErrors(form, error);
      if (!applied.hasFieldErrors) {
        toast.error(form.formState.errors.root?.message ?? `Could not save this ${noun}`);
      }
    };
    const onSuccess = () => {
      toast.success(isEdit ? `${values.name} updated` : `${values.name} added`);
      onOpenChange(false);
    };

    // "" is sent as undefined rather than as an empty string: an empty code is the absence of a
    // code, and storing "" would make two codeless rows collide on a uniqueness check one day.
    const base = { name: values.name, code: values.code || undefined };

    if (isDesignation) {
      const input = { ...base, departmentId: values.departmentId || undefined };
      if (isEdit) renameDesignation.mutate({ id: row.id, input }, { onSuccess, onError });
      else createDesignation.mutate(input, { onSuccess, onError });
      return;
    }
    if (isEdit) renameDepartment.mutate({ id: row.id, input: base }, { onSuccess, onError });
    else createDepartment.mutate(base, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${row.name}` : isDesignation ? "New job title" : "New department"}
          </DialogTitle>
          <DialogDescription>
            {isDesignation
              ? "A job title can stand on its own or sit under a department. Grouping is optional — do not invent a department just to name a role."
              : "Names are matched ignoring case and spacing, so “Kitchen” and “ kitchen ” are the same department and cannot both exist."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Short code</FormLabel>
                  <FormHint>Optional — a short form for reports, e.g. KIT</FormHint>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isDesignation ? (
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormHint>Optional</FormHint>
                    <FormControl>
                      <DepartmentSelect
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
            ) : null}

            {form.formState.errors.root ? (
              <p role="alert" className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <FormSubmitButton submitState={form.submitState}>
                {isEdit ? "Save changes" : "Add"}
              </FormSubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function defaultsFor(row: Department | Designation | undefined): LookupFormValues {
  if (!row) return { name: "", code: "", departmentId: "" };
  return {
    name: row.name,
    code: row.code ?? "",
    departmentId: "departmentId" in row ? (row.departmentId ?? "") : "",
  };
}

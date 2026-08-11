"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateTable, useUpdateTable } from "@/lib/hooks/pos/use-table-admin";
import type { DiningTable } from "@/lib/models/pos.model";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";

// Mirrors TableAdminDtos' server-side validation. Capacity is bounded on BOTH ends there for a
// reason worth repeating here: it feeds cover counts and therefore per-head reporting, so a
// fat-fingered 400 quietly distorts average-spend for the period instead of failing visibly.
const tableFormSchema = z.object({
  tableNumber: z.string().trim().min(1, "Give the table a name or number").max(20, "Keep it to 20 characters"),
  capacity: z
    .string()
    .refine((v) => /^\d+$/.test(v.trim()), "Enter a number of seats")
    .refine((v) => Number(v) >= 1 && Number(v) <= 100, "Seats must be between 1 and 100"),
  section: z.string().trim().max(50, "Keep it to 50 characters").optional(),
});

type TableFormValues = z.infer<typeof tableFormSchema>;

function defaultsFor(table: DiningTable | undefined): TableFormValues {
  if (!table) {
    return { tableNumber: "", capacity: "4", section: "" };
  }
  return {
    tableNumber: table.tableName,
    capacity: String(table.capacity),
    section: table.section ?? "",
  };
}

interface TableFormDialogProps {
  /** Present → edit that table. Absent → create. */
  table?: DiningTable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing section labels, offered as suggestions so a manager does not invent "Rooftop"
   *  three different ways. A datalist, not a select — the whole point of a free-text label is
   *  that a new one needs no setup. */
  knownSections?: string[];
}

export function TableFormDialog({
  table,
  open,
  onOpenChange,
  knownSections = [],
}: TableFormDialogProps) {
  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const isEdit = table !== undefined;
  const isPending = createTable.isPending || updateTable.isPending;

  const form = useForm<TableFormValues>({
    resolver: createZodResolver(tableFormSchema),
    defaultValues: defaultsFor(table),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(table));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table?.id]);

  function onSubmit(values: TableFormValues) {
    const input = {
      tableNumber: values.tableNumber.trim(),
      capacity: Number(values.capacity),
      section: values.section?.trim() || undefined,
    };

    if (isEdit) {
      updateTable.mutate(
        { id: table.id, input },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.tableName}`);
            onOpenChange(false);
          },
          // The duplicate-name refusal arrives here as a server message that names the table
          // and suggests reactivating a retired one — show it rather than a generic fallback.
          onError: (error) =>
            toast.error(error.message || "Could not update the table. Please try again."),
        },
      );
      return;
    }

    createTable.mutate(input, {
      onSuccess: (saved) => {
        toast.success(`Added ${saved.tableName}`);
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message || "Could not add the table. Please try again."),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit table" : "Add table"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Renaming a table does not disturb anyone sitting at it — orders stay attached."
              : "The table becomes selectable on the order screen as soon as you save."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="table-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="tableNumber"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="What staff call this table — a number, or a name like “Window 2”.">
                    Name or number
                  </FieldLabel>
                  <FormControl>
                    <Input placeholder="T1" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="How many people it normally seats. Used for cover counts and per-head reporting.">
                    Seats
                  </FieldLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="4" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="section"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Optional — a grouping label like Rooftop, Garden or Hall. Tables are grouped by it on this screen.">
                    Section
                  </FieldLabel>
                  <FormControl>
                    <Input
                      placeholder="Rooftop"
                      list="table-section-suggestions"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <datalist id="table-section-suggestions">
                    {knownSections.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="table-form" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

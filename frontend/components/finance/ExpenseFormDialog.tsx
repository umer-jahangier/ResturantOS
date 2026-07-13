"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateExpense } from "@/lib/hooks/finance/use-finance";
import { useAccounts } from "@/lib/hooks/finance/use-accounts";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { CreateExpenseInput } from "@/lib/models/finance.model";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// The amount input is rupees (what a human types); we convert to paisa on
// submit. amountRupees is a string because that's what <input> yields.
const expenseFormSchema = z.object({
  expenseAccountCode: z.string().min(1, "Select an expense account"),
  expenseDate: z.string().min(1, "Expense date is required"),
  description: z.string(),
  amountRupees: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Enter an amount greater than zero"),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function defaultValues(): ExpenseFormValues {
  return {
    expenseAccountCode: "",
    expenseDate: new Date().toISOString().split("T")[0] ?? "",
    description: "",
    amountRupees: "",
  };
}

function toCreateExpenseInput(branchId: string, values: ExpenseFormValues): CreateExpenseInput {
  const rupees = Number(values.amountRupees);
  return {
    branchId,
    expenseDate: values.expenseDate,
    expenseAccountCode: values.expenseAccountCode,
    description: values.description.trim() === "" ? undefined : values.description.trim(),
    amountPaisa: Math.round(rupees * 100),
  };
}

interface ExpenseFormDialogProps {
  trigger: React.ReactNode;
}

/** FIN-05: create an expense (starts PENDING_APPROVAL). */
export function ExpenseFormDialog({ trigger }: ExpenseFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const createExpense = useCreateExpense();
  // Reuse the same expense-account CoA lookup /app/finance/accounts uses —
  // do not fetch the Chart of Accounts a second way.
  const { data: expenseAccounts } = useAccounts({ type: "EXPENSE", active: true });

  const form = useForm<ExpenseFormValues>({
    resolver: createZodResolver(expenseFormSchema),
    defaultValues: defaultValues(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function onSubmit(values: ExpenseFormValues) {
    if (!branchId) return;
    createExpense.mutate(toCreateExpenseInput(branchId, values), {
      onSuccess: () => {
        toast.success("Expense submitted for approval");
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not submit the expense. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New expense</DialogTitle>
          <DialogDescription>
            Submitted expenses start PENDING_APPROVAL until an approver acts on them.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="expense-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="expenseAccountCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expense account</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select an account</option>
                      {expenseAccounts?.data.map((account) => (
                        <option key={account.id} value={account.code}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expenseDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expense date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amountRupees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (PKR)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="1500.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="July electricity bill" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" disabled={createExpense.isPending}>
            {createExpense.isPending ? "Submitting…" : "Submit expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

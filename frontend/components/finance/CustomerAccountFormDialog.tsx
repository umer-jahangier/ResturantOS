"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateCustomerAccount } from "@/lib/hooks/finance/use-finance";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { CreateCustomerAccountInput } from "@/lib/models/finance.model";
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

// Credit limit is rupees in (what a human types), paisa out on submit — same
// convention as ExpenseFormDialog's amountRupees field.
const customerAccountFormSchema = z.object({
  accountCode: z.string().min(2, "Account code is required"),
  name: z.string().min(2, "Name is required"),
  contactName: z.string(),
  contactPhone: z.string(),
  contactEmail: z.string(),
  creditLimitRupees: z
    .string()
    .min(1, "Credit limit is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Enter a credit limit of 0 or more"),
  paymentTermsDays: z
    .string()
    .min(1, "Payment terms are required")
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, "Enter whole days, 0 or more"),
});

type CustomerAccountFormValues = z.infer<typeof customerAccountFormSchema>;

function defaultValues(): CustomerAccountFormValues {
  return {
    accountCode: "",
    name: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    creditLimitRupees: "",
    paymentTermsDays: "30",
  };
}

function toCreateCustomerAccountInput(
  branchId: string,
  values: CustomerAccountFormValues,
): CreateCustomerAccountInput {
  return {
    branchId,
    accountCode: values.accountCode.trim(),
    name: values.name.trim(),
    contactName: values.contactName.trim() === "" ? undefined : values.contactName.trim(),
    contactPhone: values.contactPhone.trim() === "" ? undefined : values.contactPhone.trim(),
    contactEmail: values.contactEmail.trim() === "" ? undefined : values.contactEmail.trim(),
    creditLimitPaisa: Math.round(Number(values.creditLimitRupees) * 100),
    paymentTermsDays: Number(values.paymentTermsDays),
  };
}

interface CustomerAccountFormDialogProps {
  trigger: React.ReactNode;
}

/** FIN-05 AR half (10-18): create a corporate/house account (catering client, regular on account). */
export function CustomerAccountFormDialog({ trigger }: CustomerAccountFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const createCustomerAccount = useCreateCustomerAccount();

  const form = useForm<CustomerAccountFormValues>({
    resolver: createZodResolver(customerAccountFormSchema),
    defaultValues: defaultValues(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function onSubmit(values: CustomerAccountFormValues) {
    if (!branchId) return;
    createCustomerAccount.mutate(toCreateCustomerAccountInput(branchId, values), {
      onSuccess: () => {
        toast.success("House account created");
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not create the house account. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New house account</DialogTitle>
          <DialogDescription>
            A corporate or regular customer billed on account — catering invoices, phone orders,
            month-end billing. Settled later against a credit limit.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="customer-account-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="accountCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account code</FormLabel>
                    <FormControl>
                      <Input placeholder="HA-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Corp" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="contactName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact phone</FormLabel>
                    <FormControl>
                      <Input placeholder="0300-0000000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="jane@acme.test" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="creditLimitRupees"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Credit limit (PKR)</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="100000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentTermsDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment terms (days)</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="30" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="customer-account-form" disabled={createCustomerAccount.isPending}>
            {createCustomerAccount.isPending ? "Creating…" : "Create house account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

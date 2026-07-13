"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateArCharge } from "@/lib/hooks/finance/use-finance";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { CreateArChargeInput, CustomerAccount } from "@/lib/models/finance.model";
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

const chargeFormSchema = z.object({
  amountRupees: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Enter an amount greater than zero"),
  txnDate: z.string().min(1, "Date is required"),
  reference: z.string(),
});

type ChargeFormValues = z.infer<typeof chargeFormSchema>;

function defaultValues(): ChargeFormValues {
  return {
    amountRupees: "",
    txnDate: new Date().toISOString().split("T")[0] ?? "",
    reference: "",
  };
}

/**
 * 10-06-A/10-18: a 422 CREDIT_LIMIT_EXCEEDED / CUSTOMER_ACCOUNT_SUSPENDED or 423 PERIOD_LOCKED
 * must render an EXPLICIT reason, never a generic "Something went wrong" — the backend message
 * already names the limit and current balance (see CreditLimitExceededException), so we surface
 * it verbatim for those codes instead of the generic USER_FACING_BY_CODE fallback.
 */
function chargeErrorMessage(code: string, message: string): string {
  if (
    code === "CREDIT_LIMIT_EXCEEDED" ||
    code === "CUSTOMER_ACCOUNT_SUSPENDED" ||
    code === "PERIOD_LOCKED"
  ) {
    return `Charge rejected: ${message}`;
  }
  return message || "Could not post the charge. Please try again.";
}

interface ArChargeDialogProps {
  account: CustomerAccount;
  trigger: React.ReactNode;
}

/** FIN-05 AR half (10-18): post a charge to a house account — the real AR writer. */
export function ArChargeDialog({ account, trigger }: ArChargeDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const createArCharge = useCreateArCharge();

  const form = useForm<ChargeFormValues>({
    resolver: createZodResolver(chargeFormSchema),
    defaultValues: defaultValues(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function onSubmit(values: ChargeFormValues) {
    if (!branchId) return;
    const input: CreateArChargeInput = {
      branchId,
      customerAccountId: account.id,
      txnDate: values.txnDate,
      amountPaisa: Math.round(Number(values.amountRupees) * 100),
      reference: values.reference.trim() === "" ? undefined : values.reference.trim(),
    };
    createArCharge.mutate(input, {
      onSuccess: () => {
        toast.success(`Charged ${account.name}`);
        setOpen(false);
      },
      onError: (error) => {
        toast.error(chargeErrorMessage(error.code, error.message), { duration: 8000 });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Charge {account.name}</DialogTitle>
          <DialogDescription>
            Posts DR Accounts Receivable / CR revenue. Rejected if it would exceed the credit
            limit.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="ar-charge-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="amountRupees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (PKR)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="40000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="txnDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input placeholder="INV-1042" {...field} />
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
          <Button type="submit" form="ar-charge-form" disabled={createArCharge.isPending}>
            {createArCharge.isPending ? "Posting…" : "Post charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

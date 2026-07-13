"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateArSettlement } from "@/lib/hooks/finance/use-finance";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { CreateArSettlementInput, CustomerAccount } from "@/lib/models/finance.model";
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

const settlementFormSchema = z.object({
  amountRupees: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Enter an amount greater than zero"),
  txnDate: z.string().min(1, "Date is required"),
  reference: z.string(),
});

type SettlementFormValues = z.infer<typeof settlementFormSchema>;

function defaultValues(): SettlementFormValues {
  return {
    amountRupees: "",
    txnDate: new Date().toISOString().split("T")[0] ?? "",
    reference: "",
  };
}

interface ArSettlementDialogProps {
  account: CustomerAccount;
  trigger: React.ReactNode;
}

/** FIN-05 AR half (10-18): record a payment received against a house account's balance. */
export function ArSettlementDialog({ account, trigger }: ArSettlementDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const createArSettlement = useCreateArSettlement();

  const form = useForm<SettlementFormValues>({
    resolver: createZodResolver(settlementFormSchema),
    defaultValues: defaultValues(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function onSubmit(values: SettlementFormValues) {
    if (!branchId) return;
    const input: CreateArSettlementInput = {
      branchId,
      customerAccountId: account.id,
      txnDate: values.txnDate,
      amountPaisa: Math.round(Number(values.amountRupees) * 100),
      reference: values.reference.trim() === "" ? undefined : values.reference.trim(),
    };
    createArSettlement.mutate(input, {
      onSuccess: () => {
        toast.success(`Settlement recorded for ${account.name}`);
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not record the settlement. Please try again.", {
          duration: 8000,
        });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle {account.name}</DialogTitle>
          <DialogDescription>Posts DR Bank / CR Accounts Receivable.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="ar-settlement-form"
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
                    <Input placeholder="PMT-1042" {...field} />
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
          <Button type="submit" form="ar-settlement-form" disabled={createArSettlement.isPending}>
            {createArSettlement.isPending ? "Recording…" : "Record settlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreatePurchaseOrder, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { PurchaseOrderInput } from "@/lib/adapters/purchasing.adapter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";

// Every numeric field is a string here because that is what an <input> yields; conversion to the
// wire shape (numbers, paisa) happens in toPurchaseOrderInput() on submit.
const lineFormSchema = z.object({
  ingredientId: z
    .string()
    .uuid("Ingredient must be a UUID — no ingredient picker exists yet (see SUMMARY)"),
  uom: z.string().min(1, "Unit is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  unitPriceRupees: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a unit price"),
});

const poFormSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  expectedDeliveryDate: z.string(),
  notes: z.string(),
  lines: z.array(lineFormSchema).min(1, "Add at least one line"),
});

type PoFormValues = z.infer<typeof poFormSchema>;

const EMPTY_LINE = { ingredientId: "", uom: "", qty: "", unitPriceRupees: "" };

function defaultValues(): PoFormValues {
  return {
    vendorId: "",
    expectedDeliveryDate: "",
    notes: "",
    lines: [EMPTY_LINE],
  };
}

function toPurchaseOrderInput(values: PoFormValues, branchId: string): PurchaseOrderInput {
  return {
    vendorId: values.vendorId,
    branchId,
    expectedDeliveryDate: values.expectedDeliveryDate.trim() === "" ? undefined : values.expectedDeliveryDate,
    notes: values.notes.trim() === "" ? undefined : values.notes.trim(),
    lines: values.lines.map((l) => ({
      ingredientId: l.ingredientId,
      qty: l.qty.trim(),
      uom: l.uom.trim(),
      unitPricePaisa: Math.round(Number(l.unitPriceRupees) * 100),
    })),
  };
}

function lineTotalPaisa(qty: string, unitPriceRupees: string): number {
  const q = Number(qty);
  const p = Number(unitPriceRupees);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return Math.round(q * p * 100);
}

interface PurchaseOrderFormDialogProps {
  trigger: React.ReactNode;
}

/** PUR: the manager-facing create-PO form (vendor + lines) — DRAFT is the only state this creates. */
export function PurchaseOrderFormDialog({ trigger }: PurchaseOrderFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const { data: vendors } = useVendors();
  const createPo = useCreatePurchaseOrder();

  const form = useForm<PoFormValues>({
    resolver: createZodResolver(poFormSchema),
    defaultValues: defaultValues(),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = form.watch("lines");
  const total = watchedLines.reduce((sum, l) => sum + lineTotalPaisa(l.qty, l.unitPriceRupees), 0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function onSubmit(values: PoFormValues) {
    createPo.mutate(toPurchaseOrderInput(values, branchId), {
      onSuccess: () => {
        toast.success("Purchase order created as a draft");
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not create the purchase order. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Created as DRAFT — submit it for approval afterward.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="po-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[65vh] gap-4 overflow-y-auto"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="vendorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        aria-label="Vendor"
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select a vendor…</option>
                        {(vendors ?? []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
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
                name="expectedDeliveryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expected delivery date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Lines</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => append(EMPTY_LINE)}>
                  Add line
                </Button>
              </div>

              {fields.map((f, idx) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border p-2">
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.ingredientId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Ingredient ID</FormLabel>
                        <FormControl>
                          <Input placeholder="uuid" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.uom`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Unit</FormLabel>
                        <FormControl>
                          <Input placeholder="kg" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.qty`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Qty</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.unitPriceRupees`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Unit price (PKR)</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="120.00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={fields.length === 1}
                    onClick={() => remove(idx)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Total</span>
              <MoneyDisplay paisa={total} />
            </div>
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="po-form" disabled={createPo.isPending}>
            {createPo.isPending ? "Creating…" : "Create purchase order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

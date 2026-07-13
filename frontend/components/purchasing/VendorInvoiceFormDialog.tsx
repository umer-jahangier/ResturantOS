"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateVendorInvoice, usePurchaseOrders } from "@/lib/hooks/purchasing/use-purchasing";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { VendorInvoiceInput } from "@/lib/adapters/purchasing.adapter";
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
// wire shape (VendorInvoiceInput, paisa) happens in toVendorInvoiceInput() on submit.
const lineFormSchema = z.object({
  poLineId: z.string().uuid(),
  ingredientId: z.string(),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  unitPriceRupees: z.string().refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a unit price"),
});

const invoiceFormSchema = z.object({
  purchaseOrderId: z.string().min(1, "Select a purchase order"),
  invoiceNo: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  lines: z.array(lineFormSchema).min(1, "The selected PO has no lines to invoice"),
});

type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

function defaultValues(): InvoiceFormValues {
  return { purchaseOrderId: "", invoiceNo: "", invoiceDate: "", lines: [] };
}

function toVendorInvoiceInput(values: InvoiceFormValues): VendorInvoiceInput {
  return {
    purchaseOrderId: values.purchaseOrderId,
    invoiceNo: values.invoiceNo.trim(),
    invoiceDate: values.invoiceDate,
    lines: values.lines.map((l) => ({
      poLineId: l.poLineId,
      qty: l.qty.trim(),
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

interface VendorInvoiceFormDialogProps {
  trigger: React.ReactNode;
}

/**
 * Book a vendor invoice against a sent PO. Prefills one line per PO line with the PO's qty and
 * unit price, both editable — leaving them equal drives a MATCHED result (once the PO's lines
 * are fully received), editing them is how a MISSING_GRN or PRICE_OVER mismatch is produced (see
 * `matchLineStatus` in mocks/purchasing.handlers.ts and `ThreeWayMatchService` server-side).
 */
export function VendorInvoiceFormDialog({ trigger }: VendorInvoiceFormDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { branchId } = useCurrentUser();
  // Only a PO that has been sent (or partially/fully received) can be invoiced —
  // VendorInvoiceService.create rejects DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CLOSED POs.
  const { data: purchaseOrders } = usePurchaseOrders(branchId, [
    "SENT",
    "PARTIALLY_RECEIVED",
    "FULLY_RECEIVED",
  ]);
  const createInvoice = useCreateVendorInvoice();

  const form = useForm<InvoiceFormValues>({
    resolver: createZodResolver(invoiceFormSchema),
    defaultValues: defaultValues(),
  });

  const { fields, replace } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = form.watch("lines");
  const total = watchedLines.reduce((sum, l) => sum + lineTotalPaisa(l.qty, l.unitPriceRupees), 0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues());
  }

  function handlePoChange(poId: string) {
    form.setValue("purchaseOrderId", poId);
    const po = (purchaseOrders ?? []).find((p) => p.id === poId);
    if (!po) {
      replace([]);
      return;
    }
    replace(
      po.lines.map((l) => ({
        poLineId: l.id,
        ingredientId: l.ingredientId,
        qty: l.qty,
        unitPriceRupees: (l.unitPricePaisa / 100).toFixed(2),
      })),
    );
  }

  function onSubmit(values: InvoiceFormValues) {
    createInvoice.mutate(toVendorInvoiceInput(values), {
      onSuccess: (invoice) => {
        toast.success(
          invoice.status === "MATCHED"
            ? "Invoice booked and matched"
            : `Invoice booked as ${invoice.status.replaceAll("_", " ").toLowerCase()} — review the 3-way match`,
        );
        setOpen(false);
        router.push(`/app/purchasing/invoices/${invoice.id}`);
      },
      onError: (error) => {
        toast.error(error.message || "Could not book the invoice. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Book vendor invoice</DialogTitle>
          <DialogDescription>
            Pick a sent purchase order; the 3-way match runs automatically once you submit.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="invoice-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[65vh] gap-4 overflow-y-auto"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="purchaseOrderId"
                render={({ field }) => (
                  <FormItem className="sm:col-span-1">
                    <FormLabel>Purchase order</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        aria-label="Purchase order"
                        onChange={(e) => handlePoChange(e.target.value)}
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select a PO…</option>
                        {(purchaseOrders ?? []).map((po) => (
                          <option key={po.id} value={po.id}>
                            {po.id.slice(0, 8)}… ({po.status})
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
                name="invoiceNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice number</FormLabel>
                    <FormControl>
                      <Input placeholder="INV-0001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {fields.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Lines (edit qty/price to drive match outcome)</h3>
                {fields.map((f, idx) => (
                  <div key={f.id} className="grid grid-cols-[1fr_1fr] items-end gap-2 rounded border p-2">
                    <FormField
                      control={form.control}
                      name={`lines.${idx}.qty`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Invoiced qty</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" {...field} />
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
                            <Input inputMode="decimal" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>
            )}

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
          <Button type="submit" form="invoice-form" disabled={createInvoice.isPending}>
            {createInvoice.isPending ? "Booking…" : "Book invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

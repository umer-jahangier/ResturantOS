"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createZodResolver } from "@/lib/forms/zod-resolver";
import { calendarDateToInstant } from "@/lib/forms/calendar-date";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useRecordVendorItemPrice } from "@/lib/hooks/purchasing/use-purchasing";
import type { VendorItem } from "@/lib/adapters/purchasing.adapter";
import { MoneyDisplay } from "@/components/ui/money-display";
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

// Every field is a string/boolean here because that is what an <input>/toggle-button yields —
// conversion to RecordVendorItemPriceInput happens on submit.
const priceFormSchema = z.object({
  unitPriceRupees: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a unit price"),
  priceUom: z.string().min(1, "Price unit is required"),
  effectiveFrom: z.string(),
  scopeToBranch: z.boolean(),
  contractPrice: z.boolean(),
});

type PriceFormValues = z.infer<typeof priceFormSchema>;

function defaultsFor(vendorItem: VendorItem): PriceFormValues {
  return {
    unitPriceRupees: "",
    priceUom: vendorItem.currentPriceUom ?? vendorItem.orderUom,
    effectiveFrom: "",
    scopeToBranch: false,
    contractPrice: false,
  };
}

interface VendorItemPriceDialogProps {
  vendorItem: VendorItem;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * PUR-07: record a new effective-dated vendor-item price (UI-SPEC Screen 6). This is a CREATE,
 * never an in-place price edit — `useRecordVendorItemPrice` is the only mutation this file calls,
 * and there is no update-price hook anywhere to call instead (T-08.2-131/T-08.2-182). The dialog's
 * own copy states the append-only invariant verbatim so the UI itself communicates it, not just
 * the data model.
 */
export function VendorItemPriceDialog({
  vendorItem,
  trigger,
  open: openProp,
  onOpenChange,
}: VendorItemPriceDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const { branchId } = useCurrentUser();
  const recordPrice = useRecordVendorItemPrice(vendorItem.vendorId, vendorItem.id);

  const form = useForm<PriceFormValues>({
    resolver: createZodResolver(priceFormSchema),
    defaultValues: defaultsFor(vendorItem),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(vendorItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function onSubmit(values: PriceFormValues) {
    recordPrice.mutate(
      {
        unitPricePaisa: Math.round(Number(values.unitPriceRupees) * 100),
        priceUom: values.priceUom.trim(),
        effectiveFrom: calendarDateToInstant(values.effectiveFrom),
        branchId: values.scopeToBranch ? branchId : undefined,
        contractPrice: values.contractPrice,
      },
      {
        onSuccess: () => {
          toast.success("New price recorded");
          handleOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not record the new price. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a new price</DialogTitle>
          <DialogDescription>
            This creates a new price effective from the chosen date — the old price is kept for
            history and never overwritten.
          </DialogDescription>
        </DialogHeader>

        {vendorItem.currentUnitPricePaisa != null && (
          <p className="text-sm text-muted-foreground">
            Current price{" "}
            <MoneyDisplay paisa={vendorItem.currentUnitPricePaisa} className="text-foreground" />
            {vendorItem.currentPriceUom ? ` / ${vendorItem.currentPriceUom}` : ""}
          </p>
        )}

        <Form {...form}>
          <form
            id="vendor-item-price-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="unitPriceRupees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New price (PKR)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="950.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="priceUom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price unit</FormLabel>
                  <FormControl>
                    <Input placeholder="kg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effectiveFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective from</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Leave blank to take effect now.</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="scopeToBranch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch scope</FormLabel>
                  <FormControl>
                    <button
                      type="button"
                      aria-pressed={field.value}
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        field.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {field.value ? "This branch only" : "All branches"}
                    </button>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contractPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contract price</FormLabel>
                  <FormControl>
                    <button
                      type="button"
                      aria-pressed={field.value}
                      onClick={() => field.onChange(!field.value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        field.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {field.value ? "Contract price" : "Spot price"}
                    </button>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-item-price-form" disabled={recordPrice.isPending}>
            {recordPrice.isPending ? "Saving…" : "Record price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

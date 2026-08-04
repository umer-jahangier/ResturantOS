"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createZodResolver } from "@/lib/forms/zod-resolver";
import { calendarDateToInstant } from "@/lib/forms/calendar-date";
import { useIngredients } from "@/lib/hooks/inventory/use-inventory";
import { useCreateVendorItem, useUpdateVendorItem } from "@/lib/hooks/purchasing/use-purchasing";
import type { VendorItem } from "@/lib/adapters/purchasing.adapter";
import { CatalogItemCombobox, type CatalogItemOption } from "@/components/shared/catalog-item-combobox";
import { UomSelect } from "@/components/shared/uom-select";
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

// Every numeric/optional field is a string here because that is what an <input> yields —
// conversion to the wire shape (VendorItemInput/UpdateVendorItemInput) happens in the two
// toXInput() mappers below, mirroring VendorFormDialog/IngredientFormDialog's convention.
const vendorItemFormSchema = z.object({
  ingredientId: z.string().min(1, "A linked ingredient is required"),
  vendorSku: z.string(),
  vendorDescription: z.string(),
  packDescription: z.string(),
  packQty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive pack quantity"),
  packUom: z.string().min(1, "Pack unit is required"),
  orderUom: z.string().min(1, "Order unit is required"),
  minOrderQty: z.string(),
  orderMultiple: z.string(),
  leadTimeDays: z.string().refine((v) => v === "" || /^\d+$/.test(v), "Enter a whole number of days"),
  preferred: z.boolean(),
  catchWeight: z.boolean(),
  // Create-mode-only fields — ignored entirely when editing.
  initialPriceRupees: z.string(),
  initialPriceEffectiveFrom: z.string(),
});

type VendorItemFormValues = z.infer<typeof vendorItemFormSchema>;

function defaultsFor(vendorItem?: VendorItem): VendorItemFormValues {
  return {
    ingredientId: vendorItem?.ingredientId ?? "",
    vendorSku: vendorItem?.vendorSku ?? "",
    vendorDescription: vendorItem?.vendorDescription ?? "",
    packDescription: vendorItem?.packDescription ?? "",
    packQty: vendorItem?.packQty ?? "",
    packUom: vendorItem?.packUom ?? "",
    orderUom: vendorItem?.orderUom ?? "",
    minOrderQty: vendorItem?.minOrderQty ?? "",
    orderMultiple: vendorItem?.orderMultiple ?? "",
    leadTimeDays: vendorItem?.leadTimeDays != null ? String(vendorItem.leadTimeDays) : "",
    preferred: vendorItem?.preferred ?? false,
    catchWeight: vendorItem?.catchWeight ?? false,
    initialPriceRupees: "",
    initialPriceEffectiveFrom: "",
  };
}

interface VendorItemFormDialogProps {
  vendorId: string;
  /** Absent = create a new catalog item; present = edit that catalog item. */
  vendorItem?: VendorItem;
  /** Uncontrolled usage (e.g. the section header's "Add catalog item" button): render a trigger
   * and the dialog manages its own open state. Omit `trigger` and pass `open`/`onOpenChange`
   * instead for controlled usage (a row's "Edit" action inside a DropdownMenu, which has no
   * button of its own to serve as a DialogTrigger) — mirrors IngredientFormDialog's
   * controlled-dialog extension. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * PUR-07: add-or-edit a vendor catalog row (UI-SPEC Screen 6). The linked ingredient is disabled
 * in edit mode — the backend forbids re-mapping an existing catalog row to a different ingredient
 * (T-08.2-184); re-pointing at a different ingredient means creating a new catalog item instead.
 * In create mode only, an initial price seeds the first `vendor_item_prices` row through the same
 * append-only write the create endpoint delegates to (`VendorItemPriceService.recordNewPrice`) —
 * there is still no update-price path anywhere in this file.
 */
export function VendorItemFormDialog({
  vendorId,
  vendorItem,
  trigger,
  open: openProp,
  onOpenChange,
}: VendorItemFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const isEdit = vendorItem !== undefined;

  const { data: ingredients } = useIngredients();
  const createVendorItem = useCreateVendorItem(vendorId);
  const updateVendorItem = useUpdateVendorItem(vendorId);
  const mutation = isEdit ? updateVendorItem : createVendorItem;

  const form = useForm<VendorItemFormValues>({
    resolver: createZodResolver(vendorItemFormSchema),
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

  const ingredientOptions: CatalogItemOption[] = (ingredients ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    secondary: i.categoryName ?? undefined,
    sku: i.sku ?? undefined,
  }));

  function onSubmit(values: VendorItemFormValues) {
    const trimmed = (v: string) => (v.trim() === "" ? undefined : v.trim());

    if (isEdit) {
      updateVendorItem.mutate(
        {
          vendorItemId: vendorItem.id,
          input: {
            vendorSku: trimmed(values.vendorSku),
            vendorDescription: trimmed(values.vendorDescription),
            orderUom: values.orderUom.trim(),
            packDescription: trimmed(values.packDescription),
            packQty: values.packQty.trim(),
            packUom: values.packUom.trim(),
            minOrderQty: trimmed(values.minOrderQty),
            orderMultiple: trimmed(values.orderMultiple),
            leadTimeDays: values.leadTimeDays.trim() === "" ? undefined : Number(values.leadTimeDays),
            preferred: values.preferred,
            catchWeight: values.catchWeight,
          },
        },
        {
          onSuccess: () => {
            toast.success("Catalog item updated");
            handleOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not save the catalog item. Please try again.");
          },
        },
      );
      return;
    }

    const initialPriceRupees = values.initialPriceRupees.trim();
    createVendorItem.mutate(
      {
        ingredientId: values.ingredientId,
        vendorSku: trimmed(values.vendorSku),
        vendorDescription: trimmed(values.vendorDescription),
        orderUom: values.orderUom.trim(),
        packDescription: trimmed(values.packDescription),
        packQty: values.packQty.trim(),
        packUom: values.packUom.trim(),
        minOrderQty: trimmed(values.minOrderQty),
        orderMultiple: trimmed(values.orderMultiple),
        leadTimeDays: values.leadTimeDays.trim() === "" ? undefined : Number(values.leadTimeDays),
        preferred: values.preferred,
        catchWeight: values.catchWeight,
        initialUnitPricePaisa:
          initialPriceRupees === "" ? undefined : Math.round(Number(initialPriceRupees) * 100),
        initialPriceUom: initialPriceRupees === "" ? undefined : values.orderUom.trim(),
        initialPriceEffectiveFrom:
          initialPriceRupees === "" ? undefined : calendarDateToInstant(values.initialPriceEffectiveFrom),
      },
      {
        onSuccess: () => {
          toast.success("Catalog item added");
          handleOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not add the catalog item. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit catalog item" : "Add catalog item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Pack, unit, MOQ and lead-time details for this vendor's catalog row."
              : "Add an item this vendor supplies so it shows up on purchase-order lines."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="vendor-item-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2"
            noValidate
          >
            <FormField
              control={form.control}
              name="ingredientId"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Linked ingredient</FormLabel>
                  <FormControl>
                    <CatalogItemCombobox
                      options={ingredientOptions}
                      value={field.value || null}
                      onSelect={(option) => field.onChange(option.id)}
                      disabled={isEdit}
                      disabledPlaceholder="Linked ingredient can't be changed here."
                      placeholder="Select an ingredient…"
                    />
                  </FormControl>
                  {isEdit ? (
                    <p className="text-xs text-muted-foreground">
                      Re-mapping this row to a different ingredient isn&apos;t supported — add a new
                      catalog item instead.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vendorSku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor SKU</FormLabel>
                  <FormControl>
                    <Input placeholder="FF-CHKN-01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vendorDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Chicken breast, boneless" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="packDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pack description</FormLabel>
                  <FormControl>
                    <Input placeholder="10kg case" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="packQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pack quantity</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="packUom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pack unit</FormLabel>
                  <FormControl>
                    <UomSelect
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-label="Pack unit"
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    The unit the pack quantity is in. Goods receipts are converted from this into
                    the ingredient&apos;s stock unit, so it has to be a real unit.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="orderUom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order unit</FormLabel>
                  <FormControl>
                    <UomSelect
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-label="Order unit"
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    What you buy by — the unit the vendor prices.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="minOrderQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum order quantity</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="orderMultiple"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Order multiple</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="leadTimeDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead time (days)</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="2" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preferred"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred vendor item</FormLabel>
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
                      {field.value ? "Preferred" : "Not preferred"}
                    </button>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="catchWeight"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catch weight</FormLabel>
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
                      {field.value ? "Catch weight" : "Fixed weight"}
                    </button>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isEdit && (
              <>
                <FormField
                  control={form.control}
                  name="initialPriceRupees"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial price (PKR)</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="Optional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="initialPriceEffectiveFrom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective from</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Leave blank to start now.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-item-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add catalog item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

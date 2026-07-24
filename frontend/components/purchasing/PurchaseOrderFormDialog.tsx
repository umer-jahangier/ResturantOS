"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreatePurchaseOrder, useVendorItems, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { useIngredients } from "@/lib/hooks/inventory/use-inventory";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import type { PurchaseOrderInput, VendorItem } from "@/lib/adapters/purchasing.adapter";
import { CatalogItemCombobox, type CatalogItemOption } from "@/components/shared/catalog-item-combobox";
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
//
// 08.2-19 (PUR-08): a line's item is now chosen exclusively through the shared
// CatalogItemCombobox, scoped to the vendor selected on the header. The 08.2-13 interim
// hand-typed `vendorItemId` UUID input is gone — `vendorItemId` still keys the line, but it is set
// only by a picker selection. The field itself allows "" so a freshly appended row doesn't fail
// validation until submit (react-hook-form's onSubmit mode); the whole-line `.refine` below is
// what actually blocks an unpicked row, mirroring createPurchaseOrderLineInputSchema's own shape
// (frontend/lib/api-client/schemas/purchasing.schema.ts).
const lineFormSchema = z
  .object({
    vendorItemId: z.string(),
    uom: z.string().optional(),
    qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
    unitPriceRupees: z
      .string()
      .refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a unit price"),
  })
  .refine((line) => line.vendorItemId.trim() !== "", {
    message: "Select a catalog item before adding this line",
    path: ["vendorItemId"],
  });

const poFormSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  expectedDeliveryDate: z.string(),
  notes: z.string(),
  lines: z.array(lineFormSchema).min(1, "Add at least one line"),
});

type PoFormValues = z.infer<typeof poFormSchema>;

const EMPTY_LINE = { vendorItemId: "", uom: "", qty: "", unitPriceRupees: "" };

function defaultValues(): PoFormValues {
  return {
    vendorId: "",
    expectedDeliveryDate: "",
    notes: "",
    lines: [EMPTY_LINE],
  };
}

/**
 * A line's `uom`/`unitPricePaisa` are omitted from the wire payload when they still match the
 * selected catalog item's own current values — the server fills both from the catalog entry
 * (createPurchaseOrderLineInputSchema, 08.2-13), and only a genuinely edited value is sent as an
 * override (surfaced back on the response as `priceOverridden`).
 */
function toPurchaseOrderInput(
  values: PoFormValues,
  branchId: string,
  vendorItems: VendorItem[] | undefined,
): PurchaseOrderInput {
  return {
    vendorId: values.vendorId,
    branchId,
    expectedDeliveryDate: values.expectedDeliveryDate.trim() === "" ? undefined : values.expectedDeliveryDate,
    notes: values.notes.trim() === "" ? undefined : values.notes.trim(),
    lines: values.lines.map((l) => {
      const catalogItem = vendorItems?.find((v) => v.id === l.vendorItemId);
      const uom = l.uom?.trim() ?? "";
      const uomUnchanged = catalogItem != null && uom === catalogItem.orderUom;
      const catalogPriceRupees =
        catalogItem?.currentUnitPricePaisa != null
          ? (catalogItem.currentUnitPricePaisa / 100).toFixed(2)
          : undefined;
      const priceUnchanged = catalogPriceRupees != null && l.unitPriceRupees.trim() === catalogPriceRupees;
      return {
        vendorItemId: l.vendorItemId,
        qty: l.qty.trim(),
        uom: uomUnchanged ? undefined : uom || undefined,
        unitPricePaisa: priceUnchanged ? undefined : Math.round(Number(l.unitPriceRupees) * 100),
      };
    }),
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

interface PoLineItemPickerProps {
  options: CatalogItemOption[];
  value: string;
  disabled: boolean;
  isLoading: boolean;
  onSelect: (option: CatalogItemOption) => void;
}

/**
 * A single line row's item picker, split into its own component so each row's search query (and
 * the debounced "zero matches" heading derived from it) stays isolated per row instead of one
 * shared piece of state leaking between line rows.
 */
function PoLineItemPicker({ options, value, disabled, isLoading, onSelect }: PoLineItemPickerProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  return (
    <CatalogItemCombobox
      options={options}
      value={value || null}
      onSelect={onSelect}
      disabled={disabled}
      disabledPlaceholder="Select a vendor first."
      placeholder="Select an item…"
      emptyHeading={`No catalog items match “${debouncedQuery}”`}
      emptyBody="Try a different search, or add this item to the vendor's catalog first."
      isLoading={isLoading}
      onSearchChange={setQuery}
    />
  );
}

/** PUR: the manager-facing create-PO form (vendor + lines) — DRAFT is the only state this creates. */
export function PurchaseOrderFormDialog({ trigger }: PurchaseOrderFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const { data: vendors } = useVendors();
  const { data: ingredients } = useIngredients();
  const createPo = useCreatePurchaseOrder();

  const form = useForm<PoFormValues>({
    resolver: createZodResolver(poFormSchema),
    defaultValues: defaultValues(),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = form.watch("lines");
  const total = watchedLines.reduce((sum, l) => sum + lineTotalPaisa(l.qty, l.unitPriceRupees), 0);

  // 08.2-19: the picker's data source, scoped to the vendor selected on the header — `useVendorItems`
  // is `enabled` only when `vendorId` is truthy (T-08.2-194), so no catalog fetch fires before a
  // vendor is chosen.
  const vendorId = form.watch("vendorId");
  const { data: vendorItems, isLoading: vendorItemsLoading } = useVendorItems(vendorId);

  const ingredientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ingredient of ingredients ?? []) map.set(ingredient.id, ingredient.name);
    return map;
  }, [ingredients]);

  const catalogOptions: CatalogItemOption[] = useMemo(
    () =>
      (vendorItems ?? []).map((item) => ({
        id: item.id,
        // VendorItemDto carries no ingredient name of its own — resolve it from the branch's
        // ingredient list, falling back to the vendor's own description when unavailable.
        name: ingredientNameById.get(item.ingredientId) ?? item.vendorDescription ?? "Unnamed catalog item",
        secondary: [item.packDescription ?? `${item.packQty} ${item.packUom}`, `Order in ${item.orderUom}`]
          .filter(Boolean)
          .join(" · "),
        sku: item.vendorSku ?? undefined,
        pricePaisa: item.currentUnitPricePaisa ?? null,
      })),
    [vendorItems, ingredientNameById],
  );

  // T-08.2-191: a line pointed at another vendor's catalog item is rejected 422 by the server
  // regardless — clearing every line's item/unit/price the moment the header vendor changes
  // (after a real vendor was already selected) keeps the UI from ever presenting a stale line
  // that is doomed to fail on submit for a reason the user can't see.
  const prevVendorIdRef = useRef<string>("");
  useEffect(() => {
    const prevVendorId = prevVendorIdRef.current;
    if (prevVendorId && prevVendorId !== vendorId) {
      const currentLines = form.getValues("lines");
      currentLines.forEach((_, idx) => {
        form.setValue(`lines.${idx}.vendorItemId`, "");
        form.setValue(`lines.${idx}.uom`, "");
        form.setValue(`lines.${idx}.unitPriceRupees`, "");
      });
      toast.info("Lines were cleared because the vendor changed — the previous catalog no longer applies.");
    }
    prevVendorIdRef.current = vendorId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      form.reset(defaultValues());
      prevVendorIdRef.current = "";
    }
  }

  function handleSelectLineItem(idx: number, option: CatalogItemOption) {
    const catalogItem = vendorItems?.find((v) => v.id === option.id);
    form.setValue(`lines.${idx}.vendorItemId`, option.id, { shouldValidate: true });
    form.setValue(`lines.${idx}.uom`, catalogItem?.orderUom ?? "", { shouldValidate: true });
    const priceRupees = typeof option.pricePaisa === "number" ? (option.pricePaisa / 100).toFixed(2) : "";
    form.setValue(`lines.${idx}.unitPriceRupees`, priceRupees, { shouldValidate: true });
  }

  function onSubmit(values: PoFormValues) {
    createPo.mutate(toPurchaseOrderInput(values, branchId, vendorItems), {
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
      <DialogContent className="sm:max-w-3xl">
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
                <div
                  key={f.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border p-2"
                >
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.vendorItemId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Item</FormLabel>
                        <FormControl>
                          <PoLineItemPicker
                            options={catalogOptions}
                            value={field.value}
                            disabled={!vendorId}
                            isLoading={vendorItemsLoading}
                            onSelect={(option) => handleSelectLineItem(idx, option)}
                          />
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

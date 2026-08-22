"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useIngredients, useReceiveStock } from "@/lib/hooks/inventory/use-inventory";
import {
  CatalogItemCombobox,
  type CatalogItemOption,
} from "@/components/shared/catalog-item-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";

// Every numeric field is a string here because that is what an <input> yields; conversion to the
// wire shape (ReceiveStockInput, one call per line) happens in onSubmit.
/**
 * Rupees typed in the form → paisa on the wire, keeping the fraction.
 *
 * <p>A cost per stock unit is a rate, and rates are not whole paisa: Rs 0.062 per gram is 6.2
 * paisa, not 6. Rounded to 4 places to match the NUMERIC(18,4) the backend stores, so the value
 * that arrives is the value that persists — and so a float artefact never travels.
 */
function unitCostPaisaOf(rupees: string): number {
  return Math.round(Number(rupees) * 100 * 10_000) / 10_000;
}

const receiptLineFormSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  unitCostRupees: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a unit cost"),
});

const receiptFormSchema = z.object({
  lines: z.array(receiptLineFormSchema).min(1, "Add at least one ingredient line"),
});

type ReceiptFormValues = z.infer<typeof receiptFormSchema>;

const EMPTY_LINE = { ingredientId: "", qty: "", unitCostRupees: "" };

function defaultValues(): ReceiptFormValues {
  return { lines: [EMPTY_LINE] };
}

interface StockReceiptDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * INV-15 (Screen 7 / INV-04): log a stock receipt. `ReceiptDtos.ReceiveStockRequest` — the real
 * backend contract, confirmed against `ReceiptController.java` at HEAD — carries exactly ONE
 * ingredient per call and has no vendor/purchase-order-reference field at all. This form
 * therefore has no header vendor/PO inputs (a field with nowhere to persist would be dead UI —
 * see 08.2-17-SUMMARY.md's Deviations) and issues one POST per line on submit.
 */
export function StockReceiptDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: StockReceiptDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const { branchId } = useCurrentUser();
  const {
    data: ingredients,
    isError: ingredientsFailed,
    refetch: refetchIngredients,
  } = useIngredients();
  const receiveStock = useReceiveStock();

  const form = useForm<ReceiptFormValues>({
    resolver: createZodResolver(receiptFormSchema),
    defaultValues: defaultValues(),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = form.watch("lines");

  useEffect(() => {
    if (open) form.reset(defaultValues());
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

  /** Stock unit is informational only here — `ReceiveStockRequest` has no `uom` field; the qty
   * is always interpreted in the ingredient's own base unit. */
  function unitFor(ingredientId: string): string {
    return ingredients?.find((i) => i.id === ingredientId)?.baseUomCode ?? "—";
  }

  async function onSubmit(values: ReceiptFormValues) {
    try {
      await Promise.all(
        values.lines.map((line) =>
          receiveStock.mutateAsync({
            ingredientId: line.ingredientId,
            branchId,
            qty: line.qty.trim(),
            // NOT Math.round: this is a cost per stock unit, and rounding it to whole paisa here
            // would reintroduce, at the keyboard, exactly the error V12 removed from the database.
            // Someone receiving a gram-stocked ingredient at Rs 0.062/g means 6.2 paisa, not 6.
            unitCostPaisa: unitCostPaisaOf(line.unitCostRupees),
          }),
        ),
      );
      toast.success(
        values.lines.length === 1
          ? "Receipt recorded"
          : `Receipt recorded — ${values.lines.length} lines`,
      );
      handleOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not record the receipt. Please try again.";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record a stock receipt</DialogTitle>
          <DialogDescription>Add every ingredient received in this delivery.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="stock-receipt-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[65dvh] gap-4 overflow-y-auto"
            noValidate
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
                  Receipt lines
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append(EMPTY_LINE)}
                >
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
                    name={`lines.${idx}.ingredientId`}
                    render={({ field }) => (
                      <FormItem>
                        <FieldLabel className="text-xs" help="The item that arrived.">
                          Ingredient
                        </FieldLabel>
                        <FormControl>
                          <CatalogItemCombobox
                            options={ingredientOptions}
                            value={field.value || null}
                            onSelect={(option) => field.onChange(option.id)}
                            placeholder="Select an ingredient…"
                            emptyHeading="No ingredients match"
                            emptyBody="Try a different search."
                            isError={ingredientsFailed}
                            errorLabel="your ingredients"
                            onRetry={() => void refetchIngredients()}
                          />
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
                        <FieldLabel
                          className="text-xs"
                          help="How much arrived, in the unit selected beside it."
                        >
                          Qty
                        </FieldLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormItem>
                    <FieldLabel
                      className="text-xs"
                      help="The unit the delivery was measured in. It’s converted to the item’s stock unit."
                    >
                      Unit
                    </FieldLabel>
                    <FormControl>
                      <Input
                        value={unitFor(watchedLines[idx]?.ingredientId ?? "")}
                        disabled
                        readOnly
                        aria-label={`Unit for line ${idx + 1}`}
                      />
                    </FormControl>
                  </FormItem>
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.unitCostRupees`}
                    render={({ field }) => (
                      <FormItem>
                        <FieldLabel
                          className="text-xs"
                          help="What you paid per unit on this delivery. This updates the item’s running average cost."
                        >
                          Unit cost (PKR)
                        </FieldLabel>
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
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="stock-receipt-form" disabled={receiveStock.isPending}>
            {receiveStock.isPending ? "Recording…" : "Record receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

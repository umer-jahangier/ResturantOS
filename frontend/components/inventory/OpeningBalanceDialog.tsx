"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useIngredients, useRecordOpeningBalance } from "@/lib/hooks/inventory/use-inventory";
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
// wire shape (OpeningBalanceInput) happens in onSubmit, mirroring RecipeFormDialog's
// toRecipeInput() convention.
const openingBalanceFormSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  unitCostRupees: z.string().refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a unit cost"),
  expiryDate: z.string(),
});

type OpeningBalanceFormValues = z.infer<typeof openingBalanceFormSchema>;

const EMPTY_VALUES: OpeningBalanceFormValues = {
  ingredientId: "",
  qty: "",
  unitCostRupees: "",
  expiryDate: "",
};

interface OpeningBalanceDialogProps {
  /** Uncontrolled usage (e.g. a page header button): render a trigger and the dialog manages its
   * own open state. Omit `trigger` and pass `open`/`onOpenChange` for controlled usage (e.g. the
   * stock page's empty-state action, which needs the SAME dialog instance a header button also
   * opens) — mirrors IngredientFormDialog's controlled/uncontrolled hybrid (08.2-14/15). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * INV-15 (Screen 7): record a one-time opening balance for an ingredient at the current branch —
 * mirrors `InventoryDtos.RecordOpeningBalanceRequest` exactly (ingredientId/branchId/qty/
 * unitCostPaisa/expiryDate), confirmed against `OpeningBalanceController.java` at HEAD. Branch is
 * fixed to the signed-in user's current branch and rendered read-only (never a free choice here).
 */
export function OpeningBalanceDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: OpeningBalanceDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const { branchId } = useCurrentUser();
  const { data: branches } = useMyBranches();
  const {
    data: ingredients,
    isError: ingredientsFailed,
    refetch: refetchIngredients,
  } = useIngredients();
  const recordOpeningBalance = useRecordOpeningBalance();

  const branchName = (branches ?? []).find((b) => b.id === branchId)?.name ?? "Current branch";

  const form = useForm<OpeningBalanceFormValues>({
    resolver: createZodResolver(openingBalanceFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY_VALUES);
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

  function onSubmit(values: OpeningBalanceFormValues) {
    recordOpeningBalance.mutate(
      {
        ingredientId: values.ingredientId,
        branchId,
        qty: values.qty.trim(),
        // A rate per stock unit, so the fraction is kept — Rs 0.062/g is 6.2 paisa, not 6.
        // Scale 4 matches the NUMERIC(18,4) the backend stores (see StockReceiptDialog).
        unitCostPaisa: Math.round(Number(values.unitCostRupees) * 100 * 10_000) / 10_000,
        expiryDate: values.expiryDate.trim() === "" ? undefined : values.expiryDate.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Opening balance recorded");
          handleOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not record the opening balance. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Record opening balance</DialogTitle>
          <DialogDescription>
            Recorded once per ingredient per branch — the starting on-hand quantity before receipts,
            transfers or counts take over.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="opening-balance-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="ingredientId"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="The item you’re recording a starting quantity for.">
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

            <FormItem>
              <FieldLabel help="Which location this stock is sitting at.">Branch</FieldLabel>
              <FormControl>
                <Input value={branchName} disabled readOnly aria-label="Branch" />
              </FormControl>
            </FormItem>

            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="How much is physically on hand right now, in this item’s stock unit.">
                    Quantity
                  </FieldLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="10" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="unitCostRupees"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="What one unit cost you. This seeds the running average cost used to value the stock.">
                    Unit cost (PKR)
                  </FieldLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="120.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expiryDate"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Optional. If set, this batch is used before later ones and warns you as it nears.">
                    Expiry date
                  </FieldLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Optional — leave blank if this ingredient isn&apos;t perishable.
                  </p>
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
          <Button
            type="submit"
            form="opening-balance-form"
            disabled={recordOpeningBalance.isPending}
          >
            {recordOpeningBalance.isPending ? "Recording…" : "Record opening balance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

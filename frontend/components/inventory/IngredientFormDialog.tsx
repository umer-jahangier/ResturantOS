"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createZodResolver } from "@/lib/forms/zod-resolver";
import {
  useCategories,
  useCreateIngredient,
  useUoms,
  useUpdateIngredient,
} from "@/lib/hooks/inventory/use-inventory";
import type { Ingredient, IngredientInput } from "@/lib/adapters/inventory.adapter";
import { AllergenPillToggle } from "@/components/inventory/allergen-pill-toggle";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// UI-SPEC Screen 2's exact measure-type-lock copy — never re-derive this string per call site.
const LOCK_COPY = "Locked — stock transactions already exist for this ingredient.";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

// Every numeric/optional field is a string here because that is what an <input>/<select> yields;
// conversion to the wire shape (IngredientInput/UpdateIngredientInput) happens in
// toIngredientInput() on submit, mirroring RecipeFormDialog's toRecipeInput() convention.
const conversionRowSchema = z.object({
  fromUomCode: z.string().min(1, "Source unit is required"),
  toUomCode: z.string().min(1, "Target unit is required"),
  factor: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive factor"),
  note: z.string(),
});

const ingredientFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  shortName: z.string(),
  sku: z.string().min(1, "SKU is required"),
  categoryId: z.string().min(1, "A category is required"),
  description: z.string(),
  itemType: z.string(),
  measureType: z.string(),
  baseUomCode: z.string().min(1, "Stock unit is required"),
  recipeUomCode: z.string(),
  defaultYieldPct: z.string(),
  conversions: z.array(conversionRowSchema),
  parLevel: z.string(),
  reorderPoint: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a reorder point"),
  storageLocation: z.string(),
  shelfLifeDays: z.string(),
  perishable: z.boolean(),
  allergenCodes: z.array(z.string()),
  active: z.boolean(),
});

type IngredientFormValues = z.infer<typeof ingredientFormSchema>;

const EMPTY_CONVERSION = { fromUomCode: "", toUomCode: "", factor: "", note: "" };

function defaultsFor(ingredient?: Ingredient): IngredientFormValues {
  return {
    name: ingredient?.name ?? "",
    shortName: ingredient?.shortName ?? "",
    sku: ingredient?.sku ?? "",
    categoryId: ingredient?.categoryId ?? "",
    description: ingredient?.description ?? "",
    itemType: ingredient?.itemType ?? "PURCHASED",
    measureType: ingredient?.measureType ?? "COUNT",
    baseUomCode: ingredient?.baseUomCode ?? "",
    recipeUomCode: ingredient?.recipeUomCode ?? "",
    defaultYieldPct: ingredient?.defaultYieldPct ?? "",
    conversions: ingredient?.conversions?.length
      ? ingredient.conversions.map((c) => ({
          fromUomCode: c.fromUomCode,
          toUomCode: c.toUomCode,
          factor: c.factor,
          note: c.note ?? "",
        }))
      : [],
    parLevel: ingredient?.parLevel ?? "",
    reorderPoint: ingredient?.reorderPoint ?? "",
    storageLocation: ingredient?.storageLocation ?? "",
    shelfLifeDays: ingredient?.shelfLifeDays != null ? String(ingredient.shelfLifeDays) : "",
    perishable: ingredient?.perishable ?? false,
    allergenCodes: ingredient?.allergenCodes ?? [],
    active: ingredient?.active ?? true,
  };
}

/**
 * Maps the form's all-string values to the wire shape shared by create and update — everything
 * except `sku` (create-only, immutable after creation per InventoryDtos.UpdateIngredientRequest)
 * and `active` (update-only). `onSubmit` below adds whichever of those two the current mode needs,
 * mirroring RecipeFormDialog's single toRecipeInput() convention.
 */
function toIngredientInput(values: IngredientFormValues): Omit<IngredientInput, "sku"> {
  const trimmed = (v: string) => (v.trim() === "" ? undefined : v.trim());
  const conversions = values.conversions
    .filter((c) => c.fromUomCode.trim() !== "" && c.toUomCode.trim() !== "" && c.factor.trim() !== "")
    .map((c) => ({
      fromUomCode: c.fromUomCode.trim(),
      toUomCode: c.toUomCode.trim(),
      factor: c.factor.trim(),
      note: trimmed(c.note),
    }));

  return {
    name: values.name.trim(),
    baseUomCode: values.baseUomCode.trim(),
    categoryId: values.categoryId,
    shortName: trimmed(values.shortName),
    description: trimmed(values.description),
    itemType: trimmed(values.itemType),
    measureType: trimmed(values.measureType),
    recipeUomCode: trimmed(values.recipeUomCode),
    defaultYieldPct: values.defaultYieldPct.trim() === "" ? undefined : values.defaultYieldPct.trim(),
    storageLocation: trimmed(values.storageLocation),
    shelfLifeDays: values.shelfLifeDays.trim() === "" ? undefined : Number(values.shelfLifeDays),
    perishable: values.perishable,
    reorderPoint: values.reorderPoint.trim(),
    parLevel: values.parLevel.trim() === "" ? undefined : values.parLevel.trim(),
    conversions,
    allergenCodes: values.allergenCodes,
  };
}

interface IngredientFormDialogProps {
  /** Absent = create a new ingredient; present = edit that ingredient. */
  ingredient?: Ingredient;
  /** Uncontrolled usage (e.g. the page header's "Add ingredient" button): render a trigger and
   * the dialog manages its own open state. Omit `trigger` and pass `open`/`onOpenChange` instead
   * for controlled usage (e.g. a row's "Edit" action inside a DropdownMenu, which has no button
   * of its own to serve as a DialogTrigger) — mirrors CategoryFormDialog's controlled-dialog
   * extension (08.2-14). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * INV-01/INV-14: the manager-facing create-or-edit ingredient form (UI-SPEC Screen 2) — grouped
 * General/Units/Stock/Compliance sections, a dynamic conversions line list (react-hook-form's
 * field-array hook) mirroring RecipeFormDialog's dynamic-line-array shape, and a server-computed
 * measure-type lock (never re-derived in the browser).
 */
export function IngredientFormDialog({
  ingredient,
  trigger,
  open: openProp,
  onOpenChange,
}: IngredientFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const isEdit = ingredient !== undefined;
  const locked = ingredient?.measureTypeLocked ?? false;

  const { data: categories } = useCategories();
  const { data: uoms } = useUoms();
  const createIngredient = useCreateIngredient();
  const updateIngredient = useUpdateIngredient();
  const mutation = isEdit ? updateIngredient : createIngredient;

  const form = useForm<IngredientFormValues>({
    resolver: createZodResolver(ingredientFormSchema),
    defaultValues: defaultsFor(ingredient),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "conversions" });

  // Reset to the latest entity's values every time the dialog transitions to open — covers both
  // the uncontrolled (trigger-click, which round-trips through handleOpenChange) and controlled
  // (row-action-driven, which does not) opening paths with one code path (matches
  // CategoryFormDialog's identical useEffect).
  useEffect(() => {
    if (open) form.reset(defaultsFor(ingredient));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function onSubmit(values: IngredientFormValues) {
    const base = toIngredientInput(values);
    if (isEdit) {
      updateIngredient.mutate(
        { id: ingredient.id, input: { ...base, active: values.active } },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            handleOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not save the ingredient. Please try again.");
          },
        },
      );
    } else {
      createIngredient.mutate(
        { ...base, sku: values.sku.trim() },
        {
          onSuccess: (saved) => {
            toast.success(`Added ${saved.name}`);
            handleOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not save the ingredient. Please try again.");
          },
        },
      );
    }
  }

  const activeCategories = (categories ?? []).filter((c) => c.archivedAt == null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit ingredient" : "Add ingredient"}</DialogTitle>
          <DialogDescription>
            Every ingredient needs exactly one primary category — it drives default GL accounts and
            where the item shows up in recipes and purchasing.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider delayDuration={300}>
          <Form {...form}>
            <form
              id="ingredient-form"
              onSubmit={form.handleSubmit(onSubmit)}
              className="grid max-h-[65vh] gap-6 overflow-y-auto"
              noValidate
            >
              {/* General */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">General</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Chicken" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shortName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Short name</FormLabel>
                        <FormControl>
                          <Input placeholder="Optional" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SKU</FormLabel>
                        <FormControl>
                          <Input placeholder="ING-CHK" disabled={isEdit} {...field} />
                        </FormControl>
                        {isEdit ? (
                          <p className="text-xs text-muted-foreground">
                            SKU can&apos;t be changed after creation.
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary category *</FormLabel>
                        <FormControl>
                          <select {...field} aria-label="Primary category *" className={selectClass}>
                            <option value="">Select a category…</option>
                            {activeCategories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
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
                    name="itemType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item type</FormLabel>
                        <FormControl>
                          <select {...field} aria-label="Item type" className={selectClass}>
                            <option value="PURCHASED">Purchased</option>
                            <option value="PREPARED">Prepared</option>
                            <option value="BOTH">Both</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Optional" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Units */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Units</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="measureType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Measure type</FormLabel>
                        <FormControl>
                          {locked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block">
                                  <select
                                    {...field}
                                    disabled
                                    title={LOCK_COPY}
                                    aria-label="Measure type"
                                    className={selectClass}
                                  >
                                    <option value="WEIGHT">Weight</option>
                                    <option value="VOLUME">Volume</option>
                                    <option value="COUNT">Count</option>
                                  </select>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{LOCK_COPY}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <select {...field} aria-label="Measure type" className={selectClass}>
                              <option value="WEIGHT">Weight</option>
                              <option value="VOLUME">Volume</option>
                              <option value="COUNT">Count</option>
                            </select>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="baseUomCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stock unit</FormLabel>
                        <FormControl>
                          {locked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block">
                                  <select
                                    {...field}
                                    disabled
                                    title={LOCK_COPY}
                                    aria-label="Stock unit"
                                    className={selectClass}
                                  >
                                    <option value="">Select…</option>
                                    {(uoms ?? []).map((u) => (
                                      <option key={u.id} value={u.code}>
                                        {u.code}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{LOCK_COPY}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <select {...field} aria-label="Stock unit" className={selectClass}>
                              <option value="">Select…</option>
                              {(uoms ?? []).map((u) => (
                                <option key={u.id} value={u.code}>
                                  {u.code}
                                </option>
                              ))}
                            </select>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="recipeUomCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipe unit</FormLabel>
                        <FormControl>
                          <select {...field} aria-label="Recipe unit" className={selectClass}>
                            <option value="">Same as stock unit</option>
                            {(uoms ?? []).map((u) => (
                              <option key={u.id} value={u.code}>
                                {u.code}
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
                    name="defaultYieldPct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default yield %</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="100" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  The purchase unit is set per vendor item on the vendor&apos;s catalog, not here.
                </p>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Conversions</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append(EMPTY_CONVERSION)}
                    >
                      Add conversion
                    </Button>
                  </div>

                  {fields.map((f, idx) => (
                    <div
                      key={f.id}
                      className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border p-2"
                    >
                      <FormField
                        control={form.control}
                        name={`conversions.${idx}.fromUomCode`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">From</FormLabel>
                            <FormControl>
                              <select {...field} aria-label="From" className={selectClass}>
                                <option value="">Select…</option>
                                {(uoms ?? []).map((u) => (
                                  <option key={u.id} value={u.code}>
                                    {u.code}
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
                        name={`conversions.${idx}.toUomCode`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">To</FormLabel>
                            <FormControl>
                              <select {...field} aria-label="To" className={selectClass}>
                                <option value="">Select…</option>
                                {(uoms ?? []).map((u) => (
                                  <option key={u.id} value={u.code}>
                                    {u.code}
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
                        name={`conversions.${idx}.factor`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Factor</FormLabel>
                            <FormControl>
                              <Input inputMode="decimal" placeholder="0.001" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`conversions.${idx}.note`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Note</FormLabel>
                            <FormControl>
                              <Input placeholder="Optional" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stock */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Stock</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="parLevel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Par level</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="Optional" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="reorderPoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reorder point</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="storageLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Storage location</FormLabel>
                        <FormControl>
                          <Input placeholder="Walk-in Cooler" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shelfLifeDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shelf life (days)</FormLabel>
                        <FormControl>
                          <Input inputMode="numeric" placeholder="Optional" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="perishable"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Perishable</FormLabel>
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
                            {field.value ? "Perishable" : "Not perishable"}
                          </button>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Compliance */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Compliance</h3>
                <FormField
                  control={form.control}
                  name="allergenCodes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Allergens</FormLabel>
                      <FormControl>
                        <AllergenPillToggle value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </TooltipProvider>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="ingredient-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add ingredient"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

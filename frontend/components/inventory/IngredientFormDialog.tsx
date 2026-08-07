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
  useRecipeOptions,
  useStorageLocations,
  useUoms,
  useUpdateIngredient,
} from "@/lib/hooks/inventory/use-inventory";
import type { Ingredient, IngredientInput, Uom } from "@/lib/adapters/inventory.adapter";
import { AllergenPillToggle } from "@/components/inventory/allergen-pill-toggle";
import { FieldHelp, FieldLabel } from "@/components/shared/field-help";
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
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";

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
  producedByRecipeId: z.string(),
  measureType: z.string(),
  baseUomCode: z.string().min(1, "Stock unit is required"),
  recipeUomCode: z.string(),
  defaultYieldPct: z.string(),
  conversions: z.array(conversionRowSchema),
  parLevel: z.string(),
  reorderPoint: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a reorder point"),
  storageLocationId: z.string(),
  shelfLifeDays: z.string(),
  perishable: z.boolean(),
  allergenCodes: z.array(z.string()),
  active: z.boolean(),
});

type IngredientFormValues = z.infer<typeof ingredientFormSchema>;

const EMPTY_CONVERSION = { fromUomCode: "", toUomCode: "", factor: "", note: "" };

/** Renders unit `<option>`s as `code · name` — with a standard set now provisioned per tenant,
 * a bare code list ("g", "kg", "mg", "lb", "oz", …) is no longer self-explanatory at a glance. */
function unitOptions(units: Uom[]) {
  return units.map((u) => (
    <option key={u.id} value={u.code}>
      {u.code} · {u.name}
    </option>
  ));
}

/** PREPARED and BOTH are the two item types a recipe can produce; PURCHASED is not. */
function isPrepared(itemType: string): boolean {
  return itemType === "PREPARED" || itemType === "BOTH";
}

function defaultsFor(ingredient?: Ingredient): IngredientFormValues {
  return {
    name: ingredient?.name ?? "",
    shortName: ingredient?.shortName ?? "",
    sku: ingredient?.sku ?? "",
    categoryId: ingredient?.categoryId ?? "",
    description: ingredient?.description ?? "",
    itemType: ingredient?.itemType ?? "PURCHASED",
    producedByRecipeId: ingredient?.producedByRecipeId ?? "",
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
    storageLocationId: ingredient?.storageLocationId ?? "",
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
    .filter(
      (c) => c.fromUomCode.trim() !== "" && c.toUomCode.trim() !== "" && c.factor.trim() !== "",
    )
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
    // Only a prepared item may name a producing recipe — the server rejects the pair outright
    // rather than silently dropping it, so a stale id left behind by switching the type back to
    // Purchased must not be sent.
    producedByRecipeId: isPrepared(values.itemType)
      ? trimmed(values.producedByRecipeId)
      : undefined,
    measureType: trimmed(values.measureType),
    recipeUomCode: trimmed(values.recipeUomCode),
    defaultYieldPct:
      values.defaultYieldPct.trim() === "" ? undefined : values.defaultYieldPct.trim(),
    storageLocationId: trimmed(values.storageLocationId),
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
  const { data: storageLocations } = useStorageLocations();
  const { data: recipeOptions } = useRecipeOptions();
  const createIngredient = useCreateIngredient();
  const updateIngredient = useUpdateIngredient();
  const mutation = isEdit ? updateIngredient : createIngredient;

  const form = useForm<IngredientFormValues>({
    resolver: createZodResolver(ingredientFormSchema),
    defaultValues: defaultsFor(ingredient),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "conversions" });

  // The Stock/Recipe unit selects only offer units in the SELECTED dimension — a COUNT item can
  // never be stocked in grams. `measureType` is the server's own value on each UomDto (V7); it is
  // never re-derived here from the unit's code or its baseUnitCode chain, so this filter cannot
  // drift from IngredientService's matching server-side rejection.
  //
  // Conversions deliberately keep the UNFILTERED list below: crossing dimensions is their whole
  // purpose ("1 each = 0.18 kg" is how an item purchased by count is stocked by weight).
  const measureType = form.watch("measureType");
  const dimensionUnits = (uoms ?? []).filter((u) => u.measureType === measureType);

  const itemType = form.watch("itemType");
  // Archived locations are excluded from the picker but NOT from a saved ingredient — an item
  // already filed in a location that later gets archived keeps its value, exactly as with
  // categories. Only new assignments are blocked (server-side too, with a 422).
  const activeLocations = (storageLocations ?? []).filter((l) => l.archivedAt == null);

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
              {/* Name and Description carry no help affordance on purpose: a "?" that only
                  restates the label is noise, and thirty fields of noise is what makes help
                  invisible on the fields that genuinely need it. */}
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
                        <FieldLabel help="A shorter label for tight spaces — count sheets, kitchen tickets, narrow reports.">
                          Short name
                        </FieldLabel>
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
                        <FieldLabel help="Your own code for this item. Used to search for it and to line it up with supplier catalogues. It can’t be changed later.">
                          SKU
                        </FieldLabel>
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
                        <FieldLabel help="Decides which GL accounts this item posts to, and how it’s grouped in cost reports. Every item needs exactly one.">
                          Primary category *
                        </FieldLabel>
                        <FormControl>
                          <select
                            {...field}
                            aria-label="Primary category *"
                            className={selectClass}
                          >
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
                        <FieldLabel help="Purchased = you buy it in. Prepared = your kitchen makes it. Both = you do either, depending on the day.">
                          Item type
                        </FieldLabel>
                        <FormControl>
                          <select
                            {...field}
                            aria-label="Item type"
                            className={selectClass}
                            onChange={(e) => {
                              field.onChange(e);
                              // Switching back to Purchased clears the recipe rather than hiding
                              // it: a value the user can no longer see but would still submit is
                              // exactly the mismatch the server refuses.
                              if (!isPrepared(e.target.value)) {
                                form.setValue("producedByRecipeId", "");
                              }
                            }}
                          >
                            <option value="PURCHASED">Purchased</option>
                            <option value="PREPARED">Prepared</option>
                            <option value="BOTH">Both</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Only rendered for a prepared item — an in-house prep has a recipe behind it,
                      a purchased one does not, and the server enforces the same pairing. */}
                  {isPrepared(itemType) ? (
                    <FormField
                      control={form.control}
                      name="producedByRecipeId"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FieldLabel help="The recipe your kitchen follows to make this item.">
                            Produced by recipe
                          </FieldLabel>
                          <FormControl>
                            <select
                              {...field}
                              aria-label="Produced by recipe"
                              className={selectClass}
                            >
                              <option value="">Not linked yet</option>
                              {(recipeOptions ?? []).map((r) => (
                                <option key={r.recipeId} value={r.recipeId}>
                                  {r.name ? `${r.menuItemName} — ${r.name}` : r.menuItemName} (v
                                  {r.version})
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Optional. You can save the item now and link its recipe once you&apos;ve
                            written one — the recipe has to reference this item, so it comes second.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

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
                        <FieldLabel help="Whether you track this by weight, by volume, or by counting units. It locks once stock has moved.">
                          Measure type
                        </FieldLabel>
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
                            <select
                              {...field}
                              aria-label="Measure type"
                              className={selectClass}
                              onChange={(e) => {
                                field.onChange(e);
                                // Both unit fields are scoped to the dimension, so a value picked
                                // under the old one is no longer offered — clear rather than leave
                                // a selection the user can see in neither dropdown but would still
                                // submit (and which the server would reject as a mismatch).
                                form.setValue("baseUomCode", "");
                                form.setValue("recipeUomCode", "");
                              }}
                            >
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
                        <FieldLabel help="The unit you hold and count stock in. Everything else converts to this.">
                          Stock unit
                        </FieldLabel>
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
                                    {unitOptions(dimensionUnits)}
                                  </select>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{LOCK_COPY}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <select {...field} aria-label="Stock unit" className={selectClass}>
                              <option value="">Select…</option>
                              {unitOptions(dimensionUnits)}
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
                        <FieldLabel help="The unit recipes usually call for, when that differs from how you stock it — stocked in kg, cooked in g.">
                          Recipe unit
                        </FieldLabel>
                        <FormControl>
                          <select {...field} aria-label="Recipe unit" className={selectClass}>
                            <option value="">Same as stock unit</option>
                            {unitOptions(dimensionUnits)}
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
                        <FieldLabel help="How much is left after trimming, peeling or boning. 100% means no loss; chicken at 95% means 1 kg buys you 950 g usable.">
                          Default yield %
                        </FieldLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="100" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Stock and recipe units are limited to the selected measure type. Conversions below
                  may cross measure types — that is how an item purchased by count is stocked by
                  weight. The purchase unit is set per vendor item on the vendor&apos;s catalog, not
                  here.
                </p>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-medium">Conversions</h4>
                      <FieldHelp label="Conversions">
                        How this item&apos;s units relate to each other, when the standard ones
                        can&apos;t say it — &ldquo;1 crate = 12 kg&rdquo;. Only needed for items you
                        buy one way and stock another.
                      </FieldHelp>
                    </div>
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
                                {unitOptions(uoms ?? [])}
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
                                {unitOptions(uoms ?? [])}
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
                        <FieldLabel help="How much you want on the shelf when fully stocked. Ordering suggestions top you back up to this number.">
                          Par level
                        </FieldLabel>
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
                        <FieldLabel help="The level that triggers a low-stock warning. Set it high enough to cover how long your supplier takes to deliver.">
                          Reorder point
                        </FieldLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="10" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Was a free-text Input until V10 made storage location master data, for the
                      same reason the category field is a select: three spellings of one walk-in
                      is three walk-ins to every report that tries to group by it. */}
                  <FormField
                    control={form.control}
                    name="storageLocationId"
                    render={({ field }) => (
                      <FormItem>
                        <FieldLabel help="Where this physically lives, so a count sheet can follow the room instead of jumping around.">
                          Storage location
                        </FieldLabel>
                        <FormControl>
                          <select {...field} aria-label="Storage location" className={selectClass}>
                            <option value="">Not specified</option>
                            {activeLocations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        {activeLocations.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No locations yet — add them under Inventory → Setup.
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shelfLifeDays"
                    render={({ field }) => (
                      <FormItem>
                        <FieldLabel help="How long it stays good after delivery. Used to warn you before stock expires.">
                          Shelf life (days)
                        </FieldLabel>
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
                        <FieldLabel help="Mark items that spoil. These are tracked by expiry date and always used oldest-first.">
                          Perishable
                        </FieldLabel>
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
                      <FieldLabel help="Carries through to every recipe using this item, and onto menus and kitchen tickets.">
                        Allergens
                      </FieldLabel>
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

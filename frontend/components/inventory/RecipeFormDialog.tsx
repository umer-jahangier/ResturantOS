"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import {
  useCreateRecipe,
  useIngredients,
  useMenuItemCatalog,
  useUoms,
} from "@/lib/hooks/inventory/use-inventory";
import type { RecipeInput } from "@/lib/adapters/inventory.adapter";
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

// Every numeric field is a string here because that is what an <input>/<select> yields;
// conversion to the wire shape (RecipeInput) happens in toRecipeInput() on submit.
const lineFormSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
  uomCode: z.string().min(1, "Unit is required"),
  yieldPct: z.string().optional(),
});

const recipeFormSchema = z.object({
  menuItemId: z.string().min(1, "Menu item is required"),
  yieldServings: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive yield"),
  effectiveFrom: z.string().optional(),
  name: z.string().optional(),
  lines: z.array(lineFormSchema).min(1, "Add at least one ingredient line"),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

const EMPTY_LINE = { ingredientId: "", qty: "", uomCode: "", yieldPct: "" };

function defaultValues(menuItemId?: string): RecipeFormValues {
  return {
    menuItemId: menuItemId ?? "",
    yieldServings: "",
    effectiveFrom: "",
    name: "",
    lines: [EMPTY_LINE],
  };
}

/**
 * An <input type="date"> yields a bare calendar date ("2026-07-22") carrying no timezone. Pinning
 * it to midnight *UTC* puts it ahead of local midnight in every positive-offset zone (PKT is
 * +05:00), so picking "today" produced an effectiveFrom up to a day in the future. Coverage counts
 * a menu item as covered only when `effective_from <= now()` (RecipeService.getCoverage), while the
 * versions table keys off `is_current` — so the recipe showed "Current: Yes" and the coverage count
 * never moved. Interpret the picked date as LOCAL midnight, which is always at or before now.
 *
 * Returns undefined for a partial/invalid value so the caller falls back to the server's
 * Instant.now() default instead of throwing a RangeError out of the submit handler.
 */
function calendarDateToInstant(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

function toRecipeInput(values: RecipeFormValues): RecipeInput {
  return {
    menuItemId: values.menuItemId,
    yieldServings: values.yieldServings,
    name: values.name?.trim() ? values.name.trim() : undefined,
    effectiveFrom:
      values.effectiveFrom && values.effectiveFrom.trim() !== ""
        ? calendarDateToInstant(values.effectiveFrom)
        : undefined,
    lines: values.lines.map((l) => ({
      ingredientId: l.ingredientId,
      qty: l.qty.trim(),
      uomCode: l.uomCode.trim(),
      yieldPct: l.yieldPct && l.yieldPct.trim() !== "" ? Number(l.yieldPct) : undefined,
    })),
  };
}

interface RecipeFormDialogProps {
  trigger: React.ReactNode;
  /** Pre-select the menu item (e.g. the one already selected on the recipes page). */
  defaultMenuItemId?: string;
}

/** INV-10: the manager-facing create-recipe-version form (menu item + dynamic ingredient lines). */
export function RecipeFormDialog({ trigger, defaultMenuItemId }: RecipeFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { data: menuItems } = useMenuItemCatalog();
  const { data: ingredients } = useIngredients();
  const { data: uoms } = useUoms();
  const createRecipe = useCreateRecipe();

  const form = useForm<RecipeFormValues>({
    resolver: createZodResolver(recipeFormSchema),
    defaultValues: defaultValues(defaultMenuItemId),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) form.reset(defaultValues(defaultMenuItemId));
  }

  function onSubmit(values: RecipeFormValues) {
    createRecipe.mutate(toRecipeInput(values), {
      onSuccess: () => {
        toast.success("Recipe version created");
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not create the recipe version. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New recipe version</DialogTitle>
          <DialogDescription>
            A new version becomes the current effective recipe for this menu item.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="recipe-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[65vh] gap-4 overflow-y-auto"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="menuItemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Menu item</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        aria-label="Menu item"
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select a menu item…</option>
                        {(menuItems ?? []).map((mi) => (
                          <option key={mi.menuItemId} value={mi.menuItemId}>
                            {mi.name}
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
                name="yieldServings"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yield (servings)</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="1" {...field} />
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
                    <p className="text-xs text-muted-foreground">
                      Leave blank to start now. A future date schedules the recipe — it will not
                      deplete stock or count towards coverage until then.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipe name</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Ingredient lines</h3>
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
                        <FormLabel className="text-xs">Ingredient</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            aria-label="Ingredient"
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <option value="">Select…</option>
                            {(ingredients ?? []).map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
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
                    name={`lines.${idx}.qty`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Qty</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="0.2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.uomCode`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Unit</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            aria-label="Unit"
                            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
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
                    name={`lines.${idx}.yieldPct`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Yield %</FormLabel>
                        <FormControl>
                          <Input inputMode="decimal" placeholder="Optional" {...field} />
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
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="recipe-form" disabled={createRecipe.isPending}>
            {createRecipe.isPending ? "Creating…" : "Create recipe version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

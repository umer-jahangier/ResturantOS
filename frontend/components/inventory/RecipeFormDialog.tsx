"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { calendarDateToInstant } from "@/lib/forms/calendar-date";
import {
  useCreateRecipe,
  useIngredients,
  useMenuItemCatalog,
  useUoms,
} from "@/lib/hooks/inventory/use-inventory";
import { useMenuCategories } from "@/lib/hooks/pos/use-menu";
import { useCreateMenuItem } from "@/lib/hooks/pos/use-menu-admin";
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
import { FieldLabel } from "@/components/shared/field-help";
import {
  CatalogItemCombobox,
  type CatalogItemOption,
} from "@/components/shared/catalog-item-combobox";

// How long to poll inventory-service's copy of the catalog for a menu item just created in
// pos-service before giving up and saying so. MENU_ITEM_UPSERTED normally lands in well under a
// second in this stack; 8s is "clearly wrong" territory, not typical latency.
const MENU_ITEM_SYNC_TIMEOUT_MS = 8000;
const MENU_ITEM_SYNC_POLL_MS = 500;

const quickCreateSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  name: z.string().min(1, "Name is required"),
  priceRupees: z.string().refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a price"),
});
type QuickCreateValues = z.infer<typeof quickCreateSchema>;
const EMPTY_QUICK_CREATE: QuickCreateValues = { categoryId: "", name: "", priceRupees: "" };

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
  yieldServings: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive yield"),
  effectiveFrom: z.string().optional(),
  name: z.string().optional(),
  lines: z.array(lineFormSchema).min(1, "Add at least one ingredient line"),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

const EMPTY_LINE = { ingredientId: "", qty: "", uomCode: "", yieldPct: "" };

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function defaultValues(menuItemId?: string): RecipeFormValues {
  return {
    menuItemId: menuItemId ?? "",
    yieldServings: "",
    effectiveFrom: "",
    name: "",
    lines: [EMPTY_LINE],
  };
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

interface QuickCreateMenuItemFieldsProps {
  form: ReturnType<typeof useForm<QuickCreateValues>>;
  categories: { id: string; name: string }[];
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (values: QuickCreateValues) => void;
}

/**
 * Replaces the menu-item combobox in place while adding one — deliberately NOT a second Dialog
 * stacked on top of the Recipe dialog (this codebase has no precedent for nested Radix Dialogs,
 * and the recipe lines a manager has already typed would be an odd thing to risk on an untested
 * focus-trap interaction). Three fields only: name, category, price — everything else on a menu
 * item (description, tax rate/code) can be filled in later from the Menu Items page.
 */
function QuickCreateMenuItemFields({
  form,
  categories,
  isPending,
  onCancel,
  onSubmit,
}: QuickCreateMenuItemFieldsProps) {
  return (
    <div className="space-y-2 rounded-lg border p-2">
      {categories.length === 0 ? (
        // The scenario this whole feature exists for: a brand-new tenant with no menu category
        // yet either. Rather than chaining a THIRD level of inline creation here, point at the
        // one place that already handles it.
        <p className="text-xs text-muted-foreground">
          No menu categories yet — add one on the Menu Items page first, then come back here.
        </p>
      ) : (
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Name</FormLabel>
                <FormControl>
                  <Input placeholder="Chicken Karahi" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Category</FormLabel>
                <FormControl>
                  <select {...field} aria-label="Menu item category" className={selectClass}>
                    <option value="">Select a category…</option>
                    {categories.map((c) => (
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
            name="priceRupees"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Price (Rs)</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="450" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {/* Not just "Cancel" — the dialog's own footer already has one, and two identically
            labelled buttons on screen at once is as bad for a screen-reader user as it is
            ambiguous to a test query. */}
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel new item
        </Button>
        {categories.length > 0 ? (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={() => form.handleSubmit(onSubmit)()}
          >
            {isPending ? "Adding…" : "Add item"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** INV-10: the manager-facing create-recipe-version form (menu item + dynamic ingredient lines). */
export function RecipeFormDialog({ trigger, defaultMenuItemId }: RecipeFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [creatingMenuItem, setCreatingMenuItem] = useState(false);
  // Set right after a quick-create succeeds; cleared once inventory-service's synced copy of the
  // catalog actually contains it. Not the same moment — see the sync-poll effect below.
  const [pendingItem, setPendingItem] = useState<{ id: string; name: string } | null>(null);
  const [syncTimedOut, setSyncTimedOut] = useState(false);

  const { data: menuItems } = useMenuItemCatalog(pendingItem ? MENU_ITEM_SYNC_POLL_MS : false);
  const { data: menuCategories } = useMenuCategories();
  const { data: ingredients } = useIngredients();
  const { data: uoms } = useUoms();
  const createRecipe = useCreateRecipe();
  const createMenuItem = useCreateMenuItem();

  const form = useForm<RecipeFormValues>({
    resolver: createZodResolver(recipeFormSchema),
    defaultValues: defaultValues(defaultMenuItemId),
  });
  const quickCreateForm = useForm<QuickCreateValues>({
    resolver: createZodResolver(quickCreateSchema),
    defaultValues: EMPTY_QUICK_CREATE,
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const lines = form.watch("lines");

  // Stops polling the moment the new item shows up in inventory's synced copy — selects it and
  // returns the field to its normal picker state.
  useEffect(() => {
    if (!pendingItem) return;
    const synced = (menuItems ?? []).some((mi) => mi.menuItemId === pendingItem.id);
    if (synced) {
      form.setValue("menuItemId", pendingItem.id);
      setPendingItem(null);
      setSyncTimedOut(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItems, pendingItem]);

  // A separate timer, not a poll-count limit, so a genuinely slow-but-working sync (a busy
  // RabbitMQ under load) still resolves on its own — this only changes what the message SAYS,
  // it never stops the polling above.
  useEffect(() => {
    if (!pendingItem) {
      setSyncTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setSyncTimedOut(true), MENU_ITEM_SYNC_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingItem]);

  function handleQuickCreateSubmit(values: QuickCreateValues) {
    createMenuItem.mutate(
      {
        categoryId: values.categoryId,
        name: values.name.trim(),
        basePricePaisa: Math.round(Number(values.priceRupees) * 100),
      },
      {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name} — setting it up for recipes now…`);
          setPendingItem({ id: saved.id, name: saved.name });
          setCreatingMenuItem(false);
          quickCreateForm.reset(EMPTY_QUICK_CREATE);
        },
        onError: (error) => {
          toast.error(error.message || "Could not add the menu item. Please try again.");
        },
      },
    );
  }

  function ingredientById(id: string) {
    return (ingredients ?? []).find((i) => i.id === id);
  }

  /**
   * The units a line may call for: those in the chosen ingredient's own measure type. A line for
   * an item stocked by weight cannot legally be written in millilitres — the server refuses that
   * pair on save, and the cost preview silently excludes the line, so offering it here only ever
   * produced a rejection or a quietly un-costed recipe. Before an ingredient is chosen there is no
   * dimension to scope to, so the full list stands.
   */
  function unitsForLine(index: number) {
    const ingredient = ingredientById(lines?.[index]?.ingredientId ?? "");
    if (!ingredient?.measureType) return uoms ?? [];
    return (uoms ?? []).filter((u) => u.measureType === ingredient.measureType);
  }

  /**
   * Pre-fills a line from the ingredient just chosen: its recipe unit (falling back to its stock
   * unit) and its item-level trim yield.
   *
   * <p>`defaultYieldPct` has existed on the ingredient since 08.2-09 and nothing ever read it, so
   * every recipe line silently defaulted to 100% — meaning a chef who recorded "chicken yields 78%
   * after trim" got a plate cost computed as though there were no trim at all. These are defaults,
   * not locks: a line that legitimately differs is still free to override them.
   */
  function applyIngredientDefaults(index: number, ingredientId: string) {
    const ingredient = ingredientById(ingredientId);
    if (!ingredient) return;
    const unit = ingredient.recipeUomCode ?? ingredient.baseUomCode;
    if (unit) form.setValue(`lines.${index}.uomCode`, unit);
    if (ingredient.defaultYieldPct != null) {
      form.setValue(`lines.${index}.yieldPct`, String(ingredient.defaultYieldPct));
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      form.reset(defaultValues(defaultMenuItemId));
    } else {
      // Leaving mid-quick-create shouldn't leave the NEXT open of this dialog stuck showing a
      // stale mini-form or a "setting up" banner for an item that finished syncing ages ago.
      setCreatingMenuItem(false);
      setPendingItem(null);
      quickCreateForm.reset(EMPTY_QUICK_CREATE);
    }
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
                render={({ field }) => {
                  const options: CatalogItemOption[] = (menuItems ?? []).map((mi) => ({
                    id: mi.menuItemId,
                    name: mi.name,
                    secondary: mi.categoryName ?? undefined,
                  }));
                  // A menu item chosen earlier may not be on the current page of options —
                  // without this the trigger would fall back to the placeholder and read as
                  // though nothing were selected (same fix as GlAccountCombobox).
                  const selectedIsListed = options.some((o) => o.id === field.value);
                  if (field.value && !selectedIsListed) {
                    options.unshift({ id: field.value, name: field.value });
                  }

                  return (
                    <FormItem>
                      <FieldLabel help="The dish this recipe makes. Each dish can have several versions over time.">
                        Menu item
                      </FieldLabel>
                      {pendingItem ? (
                        <div
                          role="status"
                          className="flex h-8 items-center rounded-lg border border-input bg-muted/30 px-2.5 text-sm text-muted-foreground"
                        >
                          {syncTimedOut
                            ? `Still syncing "${pendingItem.name}" — try again in a moment.`
                            : `Setting up "${pendingItem.name}"…`}
                        </div>
                      ) : creatingMenuItem ? (
                        <QuickCreateMenuItemFields
                          form={quickCreateForm}
                          categories={menuCategories ?? []}
                          isPending={createMenuItem.isPending}
                          onCancel={() => {
                            setCreatingMenuItem(false);
                            quickCreateForm.reset(EMPTY_QUICK_CREATE);
                          }}
                          onSubmit={handleQuickCreateSubmit}
                        />
                      ) : (
                        <>
                          <FormControl>
                            <CatalogItemCombobox
                              options={options}
                              value={field.value || null}
                              onSelect={(option) => field.onChange(option.id)}
                              placeholder="Select a menu item…"
                              emptyHeading="No matching menu items"
                              emptyBody="Try a different search, or add a new one below."
                            />
                          </FormControl>
                          <button
                            type="button"
                            onClick={() => setCreatingMenuItem(true)}
                            className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          >
                            + Create new menu item
                          </button>
                        </>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="yieldServings"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="How many portions one batch of this recipe produces. Plate cost is the batch cost divided by this.">
                      Yield (servings)
                    </FieldLabel>
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
                    <FieldLabel help="When this version takes over. Orders placed before it keep using the older version.">
                      Effective from
                    </FieldLabel>
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
                    <FieldLabel help="An optional label for this version — “Summer menu”, “Reduced salt”.">
                      Recipe name
                    </FieldLabel>
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
                  className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2 rounded border p-2"
                >
                  <FormField
                    control={form.control}
                    name={`lines.${idx}.ingredientId`}
                    render={({ field }) => (
                      <FormItem>
                        <FieldLabel
                          className="text-xs"
                          help="The item this line uses. Picking one fills in its usual unit and yield."
                        >
                          Ingredient
                        </FieldLabel>
                        <FormControl>
                          <select
                            {...field}
                            aria-label="Ingredient"
                            className={selectClass}
                            onChange={(e) => {
                              field.onChange(e);
                              applyIngredientDefaults(idx, e.target.value);
                            }}
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
                        <FieldLabel
                          className="text-xs"
                          help="How much of the ingredient one batch needs."
                        >
                          Qty
                        </FieldLabel>
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
                        <FieldLabel
                          className="text-xs"
                          help="The unit this quantity is in. Only units matching the ingredient are offered."
                        >
                          Unit
                        </FieldLabel>
                        <FormControl>
                          <select {...field} aria-label="Unit" className={selectClass}>
                            <option value="">Select…</option>
                            {unitsForLine(idx).map((u) => (
                              <option key={u.id} value={u.code}>
                                {u.code} · {u.name}
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
                        <FieldLabel
                          className="text-xs"
                          help="How much survives prep for THIS line. Starts from the ingredient’s own figure — change it only if this dish differs."
                        >
                          Yield %
                        </FieldLabel>
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
          <Button
            type="submit"
            form="recipe-form"
            disabled={createRecipe.isPending || pendingItem !== null || creatingMenuItem}
          >
            {createRecipe.isPending ? "Creating…" : "Create recipe version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

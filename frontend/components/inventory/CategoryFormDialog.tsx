"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCategories, useCreateCategory, useUpdateCategory } from "@/lib/hooks/inventory/use-inventory";
import type {
  CreateItemCategoryInput,
  ItemCategory,
  UpdateItemCategoryInput,
} from "@/lib/adapters/inventory.adapter";
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
import { GlAccountCombobox } from "@/components/inventory/GlAccountCombobox";

const MAX_LEVEL = 3;

// Every field is a string/boolean here because that is what an <input>/<select>/toggle-button
// yields; conversion to the wire shape happens in toCreateInput()/toUpdateInput() on submit.
const categoryFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string(),
  parentId: z.string(),
  defaultInventoryAccountCode: z.string(),
  defaultCostAccountCode: z.string(),
  defaultWasteAccountCode: z.string(),
  varianceCapPct: z.string(),
  excludeFromPoSuggestions: z.boolean(),
  sortOrder: z.string().refine((v) => v.trim() === "" || /^-?\d+$/.test(v), "Enter a whole number"),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

function defaultsFor(category?: ItemCategory, defaultParentId?: string | null): CategoryFormValues {
  return {
    name: category?.name ?? "",
    code: category?.code ?? "",
    parentId: category ? (category.parentId ?? "") : (defaultParentId ?? ""),
    defaultInventoryAccountCode: category?.defaultInventoryAccountCode ?? "",
    defaultCostAccountCode: category?.defaultCostAccountCode ?? "",
    defaultWasteAccountCode: category?.defaultWasteAccountCode ?? "",
    varianceCapPct: category?.varianceCapPct ?? "",
    excludeFromPoSuggestions: category?.excludeFromPoSuggestions ?? false,
    sortOrder: category?.sortOrder != null ? String(category.sortOrder) : "",
  };
}

function toCreateInput(values: CategoryFormValues): CreateItemCategoryInput {
  const trimmed = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    parentId: values.parentId.trim() === "" ? null : values.parentId.trim(),
    name: values.name.trim(),
    code: trimmed(values.code),
    defaultInventoryAccountCode: trimmed(values.defaultInventoryAccountCode),
    defaultCostAccountCode: trimmed(values.defaultCostAccountCode),
    defaultWasteAccountCode: trimmed(values.defaultWasteAccountCode),
    varianceCapPct: values.varianceCapPct.trim() === "" ? undefined : values.varianceCapPct.trim(),
    excludeFromPoSuggestions: values.excludeFromPoSuggestions,
    sortOrder: values.sortOrder.trim() === "" ? undefined : Number(values.sortOrder),
  };
}

function toUpdateInput(values: CategoryFormValues): UpdateItemCategoryInput {
  // parentId is intentionally excluded — reparenting goes through the tree's "Move to…" flow
  // (useMoveCategory), never through this form (the parent select is disabled in edit mode).
  const trimmed = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    name: values.name.trim(),
    code: trimmed(values.code),
    defaultInventoryAccountCode: trimmed(values.defaultInventoryAccountCode),
    defaultCostAccountCode: trimmed(values.defaultCostAccountCode),
    defaultWasteAccountCode: trimmed(values.defaultWasteAccountCode),
    varianceCapPct: values.varianceCapPct.trim() === "" ? undefined : values.varianceCapPct.trim(),
    excludeFromPoSuggestions: values.excludeFromPoSuggestions,
    sortOrder: values.sortOrder.trim() === "" ? undefined : Number(values.sortOrder),
  };
}

interface InheritedAccount {
  code: string | null;
  name: string | null;
  /** The category the value actually originates from — the parent, or whatever IT inherited from. */
  from: string | null;
}

const NO_INHERITANCE: InheritedAccount = { code: null, name: null, from: null };

/**
 * The three effective accounts a child of {@code parent} would inherit.
 *
 * <p>The attribution matters: if the parent holds the value itself, the source is the parent; if
 * the parent inherited it too, the source is whichever ancestor the server already resolved it
 * from. Showing "Inherited from Poultry" when the value really comes from Proteins would send a
 * manager to edit the wrong category.
 */
function inheritedAccounts(parent: ItemCategory | null) {
  if (!parent) {
    return { inventory: NO_INHERITANCE, cost: NO_INHERITANCE, waste: NO_INHERITANCE };
  }
  const gl = parent.resolvedGlAccounts;
  const source = (inherited: boolean, inheritedFrom?: string | null) =>
    inherited ? (inheritedFrom ?? null) : parent.name;
  return {
    inventory: {
      code: gl.inventoryAccountCode ?? null,
      name: gl.inventoryAccountName ?? null,
      from: source(gl.inventoryInherited, gl.inventoryInheritedFrom),
    },
    cost: {
      code: gl.costAccountCode ?? null,
      name: gl.costAccountName ?? null,
      from: source(gl.costInherited, gl.costInheritedFrom),
    },
    waste: {
      code: gl.wasteAccountCode ?? null,
      name: gl.wasteAccountName ?? null,
      from: source(gl.wasteInherited, gl.wasteInheritedFrom),
    },
  };
}

interface CategoryFormDialogProps {
  /** Absent = create a new category; present = edit that category. */
  category?: ItemCategory;
  /** Pre-selects the parent when creating a subcategory from a row's "Add subcategory" action. */
  defaultParentId?: string | null;
  /** Uncontrolled usage (e.g. the page header's "Add category" button): render a trigger and the
   * dialog manages its own open state. Omit `trigger` and pass `open`/`onOpenChange` instead for
   * controlled usage (e.g. a row's "Edit"/"Add subcategory" action, which has no button of its
   * own to serve as a DialogTrigger). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** INV-13: the manager-facing create-or-edit category form. Mirrors VendorFormDialog's
 * create-or-edit-in-one-dialog shape (UI-SPEC Screen 1). */
export function CategoryFormDialog({
  category,
  defaultParentId,
  trigger,
  open: openProp,
  onOpenChange,
}: CategoryFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const isEdit = category !== undefined;

  const { data: categories } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const mutation = isEdit ? updateCategory : createCategory;

  const form = useForm<CategoryFormValues>({
    resolver: createZodResolver(categoryFormSchema),
    defaultValues: defaultsFor(category, defaultParentId),
  });

  // Reset to the latest entity's values every time the dialog transitions to open — covers both
  // the uncontrolled (trigger-click) and controlled (row-action-driven) opening paths, since only
  // the former round-trips through handleOpenChange below.
  useEffect(() => {
    if (open) form.reset(defaultsFor(category, defaultParentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function onSubmit(values: CategoryFormValues) {
    if (isEdit) {
      updateCategory.mutate(
        { id: category.id, input: toUpdateInput(values) },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            handleOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not save the category. Please try again.");
          },
        },
      );
    } else {
      createCategory.mutate(toCreateInput(values), {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name}`);
          handleOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "Could not save the category. Please try again.");
        },
      });
    }
  }

  const parentOptions = (categories ?? []).filter(
    (c) => c.level < MAX_LEVEL && c.id !== category?.id && c.archivedAt == null,
  );

  // What each GL slot would fall back to if left empty — read off the PARENT's already-resolved
  // accounts, not this category's own. Using the category's own would be wrong in the case that
  // matters most: a manager clearing a value they had overridden needs to see what they are about
  // to fall back to, and the category's own resolution still reports the value being removed.
  // Tracks the parent select live, so switching parent updates the placeholders.
  const watchedParentId = form.watch("parentId");
  const effectiveParentId = isEdit ? (category?.parentId ?? null) : (watchedParentId || null);
  const parentCategory = (categories ?? []).find((c) => c.id === effectiveParentId) ?? null;
  const inherited = inheritedAccounts(parentCategory);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this category's defaults. Use “Move to…” from the tree to change its parent."
              : "Categories drive default GL account codes for the ingredients assigned to them."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="category-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Poultry" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="An optional short code for this category, handy when exporting to another system.">Code</FieldLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Sits this category under another one. Children inherit the parent’s GL accounts and variance cap unless they set their own.">Parent category</FieldLabel>
                  <FormControl>
                    <select
                      {...field}
                      disabled={isEdit}
                      aria-label="Parent category"
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">No parent (top-level)</option>
                      {parentOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  {isEdit ? (
                    <p className="text-xs text-muted-foreground">
                      Use “Move to…” from the tree to reparent this category.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Controls where this appears in lists. Lower numbers come first.">Sort order</FieldLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* The three GL slots are pickers, never free text. Each is scoped to the account
                types its slot accepts (assets for inventory, COGS/expense for cost and waste), so
                a revenue account can't be filed as the inventory asset account — the same rule the
                server enforces on save. `inherited*` comes from the category's own resolved
                accounts, letting an unset field show the effective value rather than reading as
                blank when the category demonstrably has one. */}
            <FormField
              control={form.control}
              name="defaultInventoryAccountCode"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="The asset account holding the value of this stock while you own it.">Inventory GL account</FieldLabel>
                  <FormControl>
                    <GlAccountCombobox
                      usage="INVENTORY"
                      ariaLabel="Inventory GL account"
                      value={field.value}
                      onChange={field.onChange}
                      inheritedCode={inherited.inventory.code}
                      inheritedName={inherited.inventory.name}
                      inheritedFrom={inherited.inventory.from}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultCostAccountCode"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Where the cost lands when this stock is consumed by a sale.">Cost GL account</FieldLabel>
                  <FormControl>
                    <GlAccountCombobox
                      usage="COST"
                      ariaLabel="Cost GL account"
                      value={field.value}
                      onChange={field.onChange}
                      inheritedCode={inherited.cost.code}
                      inheritedName={inherited.cost.name}
                      inheritedFrom={inherited.cost.from}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultWasteAccountCode"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Where the cost lands when this stock is thrown away or written off.">Waste GL account</FieldLabel>
                  <FormControl>
                    <GlAccountCombobox
                      usage="WASTE"
                      ariaLabel="Waste GL account"
                      value={field.value}
                      onChange={field.onChange}
                      inheritedCode={inherited.waste.code}
                      inheritedName={inherited.waste.name}
                      inheritedFrom={inherited.waste.from}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="varianceCapPct"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="How far a stock count may differ from the system before someone has to explain why. Leave blank for no limit.">Variance cap %</FieldLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="Optional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="excludeFromPoSuggestions"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FieldLabel help="Turn off to keep this category off automatic ordering suggestions — for stock you order on a standing contract.">Purchase-order suggestions</FieldLabel>
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
                      {field.value ? "Excluded from PO suggestions" : "Included in PO suggestions"}
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
          <Button type="submit" form="category-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

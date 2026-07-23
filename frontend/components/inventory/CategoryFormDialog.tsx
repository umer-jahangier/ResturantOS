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
                  <FormLabel>Code</FormLabel>
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
                  <FormLabel>Parent category</FormLabel>
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
                  <FormLabel>Sort order</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultInventoryAccountCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inventory GL account</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
                  <FormLabel>Cost GL account</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
                  <FormLabel>Waste GL account</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
                  <FormLabel>Variance cap %</FormLabel>
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
                  <FormLabel>Purchase-order suggestions</FormLabel>
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

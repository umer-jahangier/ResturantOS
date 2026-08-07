"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useMenuCategories } from "@/lib/hooks/pos/use-menu";
import { useCreateMenuItem, useUpdateMenuItem } from "@/lib/hooks/pos/use-menu-admin";
import type { MenuItem } from "@/lib/models/pos.model";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring";

// Price travels the form as rupees (what a menu is priced in) and converts to paisa on submit —
// the same VendorItemPriceDialog convention (`unitPriceRupees` -> Math.round(v * 100)) used
// everywhere else in this app that collects a price from a person, not a system.
const itemFormSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  priceRupees: z.string().refine((v) => v.trim() !== "" && Number(v) >= 0, "Enter a price"),
});

type ItemFormValues = z.infer<typeof itemFormSchema>;

function defaultsFor(
  item: MenuItem | undefined,
  defaultCategoryId: string | undefined,
): ItemFormValues {
  if (!item) {
    return { categoryId: defaultCategoryId ?? "", name: "", description: "", priceRupees: "" };
  }
  return {
    categoryId: item.categoryId ?? "",
    name: item.name,
    description: item.description ?? "",
    priceRupees: (item.basePricePaisa / 100).toString(),
  };
}

interface MenuItemFormDialogProps {
  /** Present → edit that item. Absent → create. */
  item?: MenuItem;
  /** Pre-selects a category on create (e.g. "Add item" clicked from within a category's row). */
  defaultCategoryId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful create, with the new item — the Recipe dialog's inline quick-create
   * uses this to select it immediately rather than making the manager find it in a list. */
  onCreated?: (item: MenuItem) => void;
}

export function MenuItemFormDialog({
  item,
  defaultCategoryId,
  open,
  onOpenChange,
  onCreated,
}: MenuItemFormDialogProps) {
  const { data: categories } = useMenuCategories();
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const isEdit = item !== undefined;
  const isPending = createItem.isPending || updateItem.isPending;

  const form = useForm<ItemFormValues>({
    resolver: createZodResolver(itemFormSchema),
    defaultValues: defaultsFor(item, defaultCategoryId),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(item, defaultCategoryId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  function onSubmit(values: ItemFormValues) {
    const input = {
      categoryId: values.categoryId,
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      basePricePaisa: Math.round(Number(values.priceRupees) * 100),
    };

    if (isEdit) {
      updateItem.mutate(
        { id: item.id, input },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not update the item. Please try again.");
          },
        },
      );
      return;
    }

    createItem.mutate(input, {
      onSuccess: (saved) => {
        toast.success(`Added ${saved.name}`);
        onOpenChange(false);
        onCreated?.(saved);
      },
      onError: (error) => {
        toast.error(error.message || "Could not add the item. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit menu item" : "Add menu item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes apply the next time this item is ordered — orders already in progress keep their original price."
              : "This item becomes orderable immediately once saved."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="menu-item-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Which section of the menu this appears under.">
                    Category
                  </FieldLabel>
                  <FormControl>
                    <select {...field} aria-label="Category" className={selectClass}>
                      <option value="">Select a category…</option>
                      {(categories ?? []).map((c) => (
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="What shows on the menu and on the order screen.">
                    Name
                  </FieldLabel>
                  <FormControl>
                    <Input placeholder="Chicken Karahi" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Optional — shown to customers if your menu display uses it.">
                    Description
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
              name="priceRupees"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="The price a customer pays. You can change this any time — it won't affect orders already placed.">
                    Price (Rs)
                  </FieldLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="450" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="menu-item-form" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

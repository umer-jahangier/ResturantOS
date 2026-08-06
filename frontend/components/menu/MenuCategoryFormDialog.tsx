"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateMenuCategory, useUpdateMenuCategory } from "@/lib/hooks/pos/use-menu-admin";
import type { MenuCategory } from "@/lib/models/pos.model";
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

const categoryFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sortOrder: z.string().optional(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

const EMPTY: CategoryFormValues = { name: "", description: "", sortOrder: "" };

function defaultsFor(category: MenuCategory | undefined): CategoryFormValues {
  if (!category) return EMPTY;
  return {
    name: category.name,
    description: category.description ?? "",
    sortOrder: String(category.sortOrder),
  };
}

interface MenuCategoryFormDialogProps {
  /** Present → edit that category. Absent → create. */
  category?: MenuCategory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create or rename a menu category. No dependency to resolve first — a category is just a name,
 * an optional description, and where it sorts. Active state is deliberately NOT editable here
 * (mirrors the backend's `UpdateMenuCategoryRequest`, which has no `active` field) — use the
 * row's own Deactivate/Reactivate action for that, so a rename can never accidentally flip it.
 */
export function MenuCategoryFormDialog({
  category,
  open,
  onOpenChange,
}: MenuCategoryFormDialogProps) {
  const createCategory = useCreateMenuCategory();
  const updateCategory = useUpdateMenuCategory();
  const isEdit = category !== undefined;
  const isPending = createCategory.isPending || updateCategory.isPending;

  const form = useForm<CategoryFormValues>({
    resolver: createZodResolver(categoryFormSchema),
    defaultValues: defaultsFor(category),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id]);

  function onSubmit(values: CategoryFormValues) {
    const input = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      sortOrder: values.sortOrder?.trim() ? Number(values.sortOrder) : undefined,
    };

    if (isEdit) {
      updateCategory.mutate(
        { id: category.id, input },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError: (error) => {
            toast.error(error.message || "Could not update the category. Please try again.");
          },
        },
      );
      return;
    }

    createCategory.mutate(input, {
      onSuccess: (saved) => {
        toast.success(`Added ${saved.name}`);
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not add the category. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit menu category" : "Add menu category"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Renaming a category doesn't move its items or change whether it's active."
              : "Groups menu items together — e.g. Starters, Mains, Drinks."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="menu-category-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="What shows as the section heading on the menu — 'Starters', 'Mains', 'Drinks'.">
                    Name
                  </FieldLabel>
                  <FormControl>
                    <Input placeholder="Starters" {...field} />
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
                  <FieldLabel help="Optional internal note — not shown to customers.">
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
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Controls where this category appears in the menu. Lower numbers come first.">
                    Sort order
                  </FieldLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="0" {...field} />
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
          <Button type="submit" form="menu-category-form" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

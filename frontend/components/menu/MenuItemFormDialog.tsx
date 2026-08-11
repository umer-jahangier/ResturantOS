"use client";

import { useEffect, useState } from "react";
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
import { MenuItemImageField } from "@/components/menu/MenuItemImageField";

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

/**
 * The picture lives in local state rather than in the react-hook-form schema.
 *
 * <p>It is not a text field being validated on submit — the upload has already happened by the
 * time the form is submitted, and what remains is an id. Threading it through the resolver would
 * add a zod branch whose only job is to pass a string through unchanged.
 *
 * <p>`fileId` is sent on EVERY save, including a price-only edit, because the backend reads a
 * null `imageFileId` as "remove the picture" rather than "leave it alone" — see
 * UpdateMenuItemRequest. Round-tripping the existing id is what makes that safe.
 */
interface ImageState {
  fileId: string | null;
  /** Server-derived URL for an already-saved picture; null once the user picks a new file. */
  currentUrl: string | null;
}

function imageDefaultsFor(item: MenuItem | undefined): ImageState {
  return { fileId: item?.imageFileId ?? null, currentUrl: item?.imageUrl ?? null };
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

  // Initialised once per mount and deliberately NOT re-synced in the effect below. Every caller
  // passes a `key` that encodes the target (`edit-<id>` / `create-<categoryId>` / idle), so
  // switching items remounts this component and the initialiser runs again with the right item.
  // Re-setting it from an effect would be a redundant cascading render for the same result.
  const [image, setImage] = useState<ImageState>(() => imageDefaultsFor(item));

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
      // Always sent, never omitted: the backend treats a missing/null imageFileId as REMOVE.
      // On a price-only edit this round-trips the item's existing id, which is what keeps the
      // picture attached. Sending `undefined` would drop the key and silently clear it.
      imageFileId: image.fileId,
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

            {/* Outside the <Form> field machinery on purpose — the upload has already happened
                by the time this form is submitted, so what this control produces is an id, not
                a value awaiting validation. See ImageState above. */}
            <MenuItemImageField
              value={image.fileId}
              currentImageUrl={image.currentUrl}
              onChange={(fileId, previewUrl) =>
                setImage({ fileId, currentUrl: previewUrl ? null : image.currentUrl })
              }
              disabled={isPending}
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

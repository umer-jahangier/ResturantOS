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
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useTaxClasses } from "@/lib/hooks/pos/use-tax-classes";
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
  // Blank is legal and means 0% — an item can genuinely be zero-rated. What is NOT legal is a
  // value that is not a number, or one outside 0–100, which would reach the ledger as a rate.
  taxRatePct: z
    .string()
    .refine(
      (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100),
      "Enter a tax rate between 0 and 100",
    ),
  // Free text on purpose: fiscal codes are set by the tax authority, not by this product, and a
  // fixed list would be wrong in every jurisdiction but one. Blank means "no classification".
  taxRateCode: z.string().optional(),
  /**
   * F16. Three states, and they are genuinely three:
   *   ""       — follow the category's rule (the default, and what most dishes should do)
   *   <uuid>   — this dish overrides to a named class
   *   "CUSTOM" — this dish carries its own rate/code in the two fields above
   *
   * "CUSTOM" is a sentinel rather than a fourth field because the alternative — a checkbox that
   * reveals the pair — leaves a saved custom rate sitting invisible behind an unticked box. The
   * select is the single place that says what this dish's tax IS.
   */
  taxClassId: z.string().optional(),
});

/** The literal that means "this dish has its own rate", never a tax-class id. */
const CUSTOM_RATE = "CUSTOM";

type ItemFormValues = z.infer<typeof itemFormSchema>;

function defaultsFor(
  item: MenuItem | undefined,
  defaultCategoryId: string | undefined,
): ItemFormValues {
  if (!item) {
    return {
      categoryId: defaultCategoryId ?? "",
      name: "",
      description: "",
      priceRupees: "",
      taxRatePct: "",
      taxRateCode: "",
      // A new dish follows its section. That is the right default and the one that stops the
      // "40 items, 33 of them at 0%" state this feature exists to end.
      taxClassId: "",
    };
  }
  return {
    categoryId: item.categoryId ?? "",
    name: item.name,
    description: item.description ?? "",
    priceRupees: (item.basePricePaisa / 100).toString(),
    // Both round-trip. Until S0-03 the dialog held neither, so every save replaced the item's
    // fiscal classification with nothing and said so nowhere.
    taxRatePct: item.taxRatePct.toString(),
    taxRateCode: item.taxRateCode ?? "",
    // An item with no class but a rate of its own is on a CUSTOM rate — it is not "following the
    // category", and showing it as such would HIDE a rate that is really being charged and then
    // clear it on the next save. That is S0-03 again, so the decision is made from the item's own
    // two columns rather than from the server's `effectiveTaxSource` caption: a response that
    // omits the caption (an older pos-service, a fixture, a partial projection) must not be able
    // to turn a live 17% into "follows the category".
    taxClassId: item.taxClassId
      ? item.taxClassId
      : item.taxRatePct > 0 || item.taxRateCode
        ? CUSTOM_RATE
        : "",
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
  const taxClasses = useTaxClasses();
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

  /**
   * What "follow the category" actually costs, named rather than implied.
   *
   * <p>Watches the CATEGORY field, not the item's stored category: a manager moving a dish from
   * Drinks to Mains needs to see the rate change before they save, not after. A category with no
   * rule says so in the same breath as what happens instead, because "no rule" and "zero-rated"
   * look identical on a bill and are completely different decisions.
   */
  const selectedCategoryId = form.watch("categoryId");
  const selectedCategory = (categories ?? []).find((c) => c.id === selectedCategoryId);
  const inheritedLabel = selectedCategory?.taxClassName
    ? `Follow ${selectedCategory.name} — ${selectedCategory.taxClassName} ${(selectedCategory.taxClassRatePct ?? 0).toFixed(2)}%`
    : selectedCategory
      ? `Follow ${selectedCategory.name} — no rate set on that category`
      : "Follow the category";

  function onSubmit(values: ItemFormValues) {
    const usesCustomRate = values.taxClassId === CUSTOM_RATE;
    const input = {
      categoryId: values.categoryId,
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      basePricePaisa: Math.round(Number(values.priceRupees) * 100),
      // The custom pair is only sent when the dish is actually ON a custom rate. Choosing a class
      // (or falling back to the category) clears both, so a stale 16.00% cannot sit underneath a
      // dish that now reads "Standard rate 17%" and re-appear the day somebody clears the class.
      taxRatePct: usesCustomRate && values.taxRatePct.trim() !== "" ? Number(values.taxRatePct) : 0,
      // `null`, never `undefined`. The backend reads an absent taxRateCode exactly as it reads
      // null — REMOVE — so an emptied field has to travel as an explicit null for "the manager
      // cleared this" and "the form forgot to send it" to stop being the same request (S0-03).
      taxRateCode:
        usesCustomRate && values.taxRateCode?.trim() ? values.taxRateCode.trim() : null,
      // Same rule, same reason: explicit null for "follow the category" and for "custom rate",
      // never an omitted key. F16 is a FOURTH tax-shaped field on this PUT, which is exactly how
      // S0-03 got in, so it travels required-and-nullable from the day it is added.
      taxClassId: values.taxClassId && !usesCustomRate ? values.taxClassId : null,
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

            {/*
              F16 — one control that says what this dish's tax IS, and a pair of fields that
              appear only when the answer is "its own rate".

              Before S0-03 there was no tax field here at all, so every save destroyed the item's
              fiscal code. S0-03 added the rate and the code, which made a rate settable but only
              one dish at a time — the state the walkthrough measured as 40 items, 33 of them at
              zero, and a Rs 1,657.00 check taxed 1.5%. This select is the fix for THAT: the
              default is to follow the section, so a rate set once on the category reaches every
              dish under it, including the ones added later.
            */}
            <FormField
              control={form.control}
              name="taxClassId"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Most dishes should follow their category. Choose a rate here only when this one dish is taxed differently. Rates are set under Settings → Sales Tax.">
                    Sales tax
                  </FieldLabel>
                  <FormControl>
                    <Select
                      aria-label="Sales tax"
                      data-testid="item-tax-class"
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      isLoading={taxClasses.isPending}
                      error={taxClasses.isError}
                      onRetry={() => taxClasses.refetch()}
                      options={[
                        {
                          value: "",
                          // Names the inherited rate rather than saying "default", so the person
                          // choosing can see what following the category actually costs.
                          label: inheritedLabel,
                        },
                        ...(taxClasses.data ?? []).map((t) => ({
                          value: t.id,
                          label: `${t.name} — ${t.ratePct.toFixed(2)}%${t.active ? "" : " (retired)"}`,
                        })),
                        { value: CUSTOM_RATE, label: "A rate just for this item…" },
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* The custom pair, revealed only when it is the answer. The rate is what the bill
                charges and the code is what the tax return files it under, and they are only ever
                read together — so they are one row, and they are never on screen claiming to
                describe a dish whose rate actually comes from a class. */}
            {form.watch("taxClassId") === CUSTOM_RATE ? (
              <div className="grid grid-cols-2 gap-3" data-testid="item-custom-rate-fields">
                <FormField
                  control={form.control}
                  name="taxRatePct"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel help="Sales tax charged on this item, as a percentage. Leave blank for zero-rated items.">
                        Tax rate (%)
                      </FieldLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxRateCode"
                  render={({ field }) => (
                    <FormItem>
                      <FieldLabel help="Your tax authority's classification code for this item, e.g. SR-STD-17. Clear it to remove the classification.">
                        Tax code
                      </FieldLabel>
                      <FormControl>
                        <Input placeholder="SR-STD-17" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

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

"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateUom, useUoms, useUpdateUom } from "@/lib/hooks/inventory/use-inventory";
import type { Uom } from "@/lib/adapters/inventory.adapter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring";

// Every numeric field is a string here because that is what an <input> yields; conversion happens
// on submit, mirroring IngredientFormDialog's toIngredientInput() convention.
const uomFormSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  measureType: z.enum(["WEIGHT", "VOLUME", "COUNT"]),
  baseUnitCode: z.string(),
  toBaseFactor: z
    .string()
    .refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive factor"),
});

type UomFormValues = z.infer<typeof uomFormSchema>;

const EMPTY: UomFormValues = {
  code: "",
  name: "",
  measureType: "WEIGHT",
  baseUnitCode: "",
  toBaseFactor: "1",
};

/** The units a new unit may be defined in terms of: the BASE units of the chosen dimension. A
 * house "Case" is 24 EACH, never 2 DOZEN — chaining conversions is how rounding error compounds,
 * and it is what the server refuses too. */
function baseUnitsFor(uoms: Uom[], measureType: string) {
  return uoms.filter((u) => u.measureType === measureType && !u.baseUnitCode);
}

interface UomFormDialogProps {
  trigger: React.ReactNode;
  /** Present = edit that unit. Absent = create a new one. */
  editing?: Uom;
}

/**
 * Adds a house unit ("Case", "Bunch", "Sheet Pan") to the tenant's unit list.
 *
 * <p>Every tenant is provisioned with a standard 14-unit set lazily, but until this dialog existed
 * `POST /api/v1/inventory/uom` had no caller at all — so a kitchen that buys by the case had no
 * way to say so, anywhere.
 */
export function UomFormDialog({ trigger, editing }: UomFormDialogProps) {
  const [open, setOpen] = useState(false);
  const { data: uoms } = useUoms();
  const createUom = useCreateUom();
  const updateUom = useUpdateUom();
  const isEditing = editing !== undefined;
  const pending = createUom.isPending || updateUom.isPending;

  const form = useForm<UomFormValues>({
    resolver: createZodResolver(uomFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            code: editing.code,
            name: editing.name,
            measureType: (editing.measureType as UomFormValues["measureType"]) ?? "WEIGHT",
            baseUnitCode: editing.baseUnitCode ?? "",
            toBaseFactor: String(editing.toBaseFactor ?? "1"),
          }
        : EMPTY,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const measureType = form.watch("measureType");
  const baseUnits = baseUnitsFor(uoms ?? [], measureType);
  const baseUnitCode = form.watch("baseUnitCode");
  // A unit with no base IS the base of its family, so its factor is 1 by definition — the server
  // enforces exactly this, and showing it as an editable "1" would invite a rejected save.
  const isFamilyBase = baseUnitCode.trim() === "";

  function onSubmit(values: UomFormValues) {
    const shared = {
      name: values.name.trim(),
      measureType: values.measureType,
      baseUnitCode: values.baseUnitCode.trim() || undefined,
      toBaseFactor: isFamilyBase ? "1" : values.toBaseFactor.trim(),
    };
    const handlers = {
      onSuccess: (saved: Uom) => {
        toast.success(isEditing ? `Updated ${saved.code} · ${saved.name}` : `Added ${saved.code} · ${saved.name}`);
        setOpen(false);
      },
      onError: (error: { message?: string }) => {
        // The server's own words. Its refusals name the conflicting unit, the dimension mismatch
        // or the family-base rule, and none of that survives being replaced with "Please try again".
        toast.error(error.message || "Could not save the unit. Please try again.");
      },
    };
    // `code` is deliberately NOT sent on an update: it is a foreign key by value into ingredients,
    // conversion rows and purchasing's vendor catalog, and the server ignores it anyway.
    if (editing) {
      updateUom.mutate({ id: editing.id, input: shared }, handlers);
    } else {
      createUom.mutate({ code: values.code.trim(), ...shared }, handlers);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${editing.code}` : "Add unit"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Correct this unit's name, dimension or conversion factor. The code cannot be changed."
              : "Define a unit your kitchen buys or counts in. It becomes available on every ingredient in the same measure type."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="uom-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="The short code you’ll see in dropdowns — CASE, BUNCH, TRAY.">
                      Code
                    </FieldLabel>
                    <FormControl>
                      <Input placeholder="CASE" disabled={isEditing} {...field} />
                    </FormControl>
                    {isEditing && (
                      <p className="text-xs text-muted-foreground">
                        A code can’t be changed — ingredients, conversions and vendor catalog rows
                        refer to it by this exact text. To change a code, retire this unit and add a
                        new one.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="The full name, spelled out for anyone who doesn’t know the code.">
                      Name
                    </FieldLabel>
                    <FormControl>
                      <Input placeholder="Case" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="measureType"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="Whether this unit measures weight, volume, or a count of things.">
                      Measure type
                    </FieldLabel>
                    <FormControl>
                      <select
                        {...field}
                        aria-label="Measure type"
                        className={selectClass}
                        onChange={(e) => {
                          field.onChange(e);
                          // The base-unit list is scoped to the dimension, so a base picked under
                          // the old one is no longer offered — clear rather than submit a pair the
                          // server would reject as a mismatch.
                          form.setValue("baseUnitCode", "");
                        }}
                      >
                        <option value="WEIGHT">Weight</option>
                        <option value="VOLUME">Volume</option>
                        <option value="COUNT">Count</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="baseUnitCode"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="The base unit this converts to. Leave blank if this IS the base everything else converts to.">
                      Measured in
                    </FieldLabel>
                    <FormControl>
                      <select {...field} aria-label="Measured in" className={selectClass}>
                        <option value="">Nothing — this is a base unit</option>
                        {baseUnits.map((u) => (
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
                name="toBaseFactor"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FieldLabel help="How many of the base unit fit in one of these. A case of 24 tins is 24.">
                      How many, per unit
                    </FieldLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="24"
                        disabled={isFamilyBase}
                        {...field}
                        value={isFamilyBase ? "1" : field.value}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {isFamilyBase
                        ? "A base unit is what its family is measured in, so this is always 1."
                        : `1 ${form.watch("code").trim() || "unit"} = this many ${baseUnitCode}.`}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="uom-form" disabled={pending}>
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateBranch, useUpdateBranchById } from "@/lib/hooks/use-tenant-settings";
import type { BranchSettings, BranchSettingsPatch } from "@/lib/models/tenant-settings.model";
import { ApiError, formatUserFacingError } from "@/lib/errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";
import { TimezoneSelect, timezoneOptions } from "@/components/branches/timezone-select";

/**
 * Add or edit a branch.
 *
 * <h2>Validation happens as the user types, and names the real problem</h2>
 *
 * <p>The register's cross-cutting finding (§23) was that this product has no inline validation
 * anywhere: `-100` in a price and `not-an-email` in an email both produced `ariaInvalid: 0` on
 * type AND on blur, submit was never disabled, and the error appeared only after a round trip and
 * then failed to clear when the field was fixed. `mode: "onChange"` plus a resolver is what makes
 * this form behave the other way: every message below names the field and what is wrong with it,
 * appears while typing, and disappears the moment the value becomes valid.
 *
 * <h2>Only what changed is sent, on edit</h2>
 *
 * <p>`BranchService.update` applies each key only when non-null, so an omitted key means "leave it
 * alone". Sending a full snapshot would turn every untouched field into a write and would revert a
 * concurrent edit made between load and save.
 *
 * <h2>The server's field errors land on the fields</h2>
 *
 * <p>A duplicate name comes back as `DUPLICATE_VALUE` naming `name`, and an unresolvable zone as
 * `INVALID_TIMEZONE` naming `timezone`. Both are bound to their input rather than shown only as a
 * toast — a toast disappears, and the box the user must edit is the place the sentence belongs.
 */

const ZONE_VALUES = new Set(timezoneOptions().map((option) => option.value));

const branchFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the branch a name — this is what staff pick in the branch switcher")
    .max(150, "Keep the name to 150 characters"),
  address: z.string().max(500, "Keep the address to 500 characters"),
  phone: z
    .string()
    .refine(
      (v) => v === "" || /^[+()\d][\d\s\-()]{5,}$/.test(v),
      "Use digits, spaces, brackets and an optional leading + — letters are not a phone number",
    ),
  email: z
    .string()
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "That is not an email address — it needs an @ and a domain, like manager@yourrestaurant.pk",
    ),
  timezone: z
    .string()
    .min(1, "Pick the time zone this branch trades in — the day's takings are cut on it")
    .refine(
      (v) => ZONE_VALUES.size === 0 || ZONE_VALUES.has(v),
      "Pick a time zone from the list. Reports are computed on it, so it has to be one the system knows.",
    ),
  openedOn: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use the date picker"),
});

type BranchFormValues = z.infer<typeof branchFormSchema>;

const BLANK: BranchFormValues = {
  name: "",
  address: "",
  phone: "",
  email: "",
  timezone: "Asia/Karachi",
  openedOn: "",
};

function defaultsFor(branch: BranchSettings | undefined): BranchFormValues {
  if (!branch) return BLANK;
  return {
    name: branch.name,
    address: branch.address ?? "",
    phone: branch.phone ?? "",
    email: branch.email ?? "",
    timezone: branch.timezone ?? "Asia/Karachi",
    openedOn: branch.openedOn ?? "",
  };
}

/** Exported for the test that proves an untouched field is never written. */
export function changedFieldsOnly(
  values: BranchFormValues,
  branch: BranchSettings,
): BranchSettingsPatch {
  const patch: BranchSettingsPatch = {};
  const original = defaultsFor(branch);
  (Object.keys(values) as (keyof BranchFormValues)[]).forEach((key) => {
    if (values[key] !== original[key]) {
      patch[key] = values[key];
    }
  });
  return patch;
}

export function BranchFormDialog({
  branch,
  open,
  onOpenChange,
}: {
  /** Present → edit that branch. Absent → create a new one. */
  branch?: BranchSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranchById();
  const isEdit = branch !== undefined;
  const isPending = createBranch.isPending || updateBranch.isPending;

  const form = useForm<BranchFormValues>({
    resolver: createZodResolver(branchFormSchema),
    defaultValues: defaultsFor(branch),
    // The whole point: a message while the user types, not after a failed submit.
    mode: "onChange",
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(branch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branch?.id]);

  /** Put a server refusal on the input that caused it; fall back to a toast if it names no field. */
  function surfaceError(error: unknown) {
    let bound = false;
    if (error instanceof ApiError) {
      for (const detail of error.fieldErrors) {
        if (detail.field in BLANK) {
          form.setError(detail.field as keyof BranchFormValues, {
            type: "server",
            message: detail.issue,
          });
          bound = true;
        }
      }
    }
    // A refusal with no field — a 403, an outage — has no box to sit under, so it goes to a toast.
    // Never both: the same sentence in two places reads as two separate problems.
    if (!bound) toast.error(formatUserFacingError(error));
  }

  function onSubmit(values: BranchFormValues) {
    if (isEdit && branch) {
      const patch = changedFieldsOnly(values, branch);
      if (Object.keys(patch).length === 0) {
        toast.info("Nothing to save — no field changed.");
        return;
      }
      updateBranch.mutate(
        { branchId: branch.id, patch },
        {
          onSuccess: (saved) => {
            toast.success(`Saved ${saved.name}.`);
            onOpenChange(false);
          },
          onError: surfaceError,
        },
      );
      return;
    }

    createBranch.mutate(
      {
        name: values.name,
        // Empty strings are omitted rather than sent: the server treats a present key as a write,
        // and "" would store an empty address instead of leaving the field unset.
        ...(values.address ? { address: values.address } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.email ? { email: values.email } : {}),
        timezone: values.timezone,
        ...(values.openedOn ? { openedOn: values.openedOn } : {}),
      },
      {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name}. You can now switch to it.`);
          onOpenChange(false);
        },
        onError: surfaceError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit branch" : "Add a branch"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Everyone working on this branch sees these details, and they appear on its receipts."
              : "A branch is one trading location. You will be put on it straight away, so you can switch to it and start setting it up."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="branch-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="What staff see in the branch switcher and on reports — “Rooftop”, “F-7 Markaz”.">
                    Branch name
                  </FieldLabel>
                  <FormControl>
                    <Input
                      placeholder="Gulberg"
                      autoComplete="off"
                      data-testid="branch-name-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Printed on this branch's receipts. One line — street, area, city.">
                    Address
                  </FieldLabel>
                  <FormControl>
                    <Input
                      placeholder="12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad"
                      autoComplete="off"
                      data-testid="branch-address-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FieldLabel help="The business day is cut on this zone. Change it and yesterday's takings move.">
                    Time zone
                  </FieldLabel>
                  <TimezoneSelect
                    id="branch-timezone"
                    value={field.value}
                    onChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  <FormDescription>
                    An IANA name. Business dates, takings and reports are computed on it.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Phone</FieldLabel>
                    <FormControl>
                      <Input {...field} inputMode="tel" placeholder="051 000 0000" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>Email</FieldLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="rooftop@yourrestaurant.pk" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="openedOn"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Used by reports that compare a branch against its own first months.">
                    Opened on
                  </FieldLabel>
                  <FormControl>
                    <Input {...field} type="date" className="sm:w-1/2" />
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
          <Button
            type="submit"
            form="branch-form"
            disabled={isPending}
            data-testid="branch-form-submit"
          >
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

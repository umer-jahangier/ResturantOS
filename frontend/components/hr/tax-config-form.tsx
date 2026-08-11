"use client";

import * as React from "react";
import { useFieldArray } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormHint,
  FormItem,
  FormLabel,
  FormMessage,
  FormSubmitButton,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { applyServerFieldErrors, useStandardForm } from "@/lib/forms";
import { useSaveTaxConfig } from "@/lib/hooks/hr/use-hr-config";
import type { TaxConfig } from "@/lib/models/hr.model";

/**
 * The income-tax and EOBI table an accountant types (D-35-05).
 *
 * <h2>Why this screen is the phase's hard blocker</h2>
 *
 * `hr_db.tax_config` held one row — Liquibase-seeded, for a placeholder tenant, for a fiscal year
 * that had already ended. Payroll asks for the fiscal year of the period being run and refuses when
 * there is none, so payroll could not run for any real tenant, and the documented remedy was an
 * INSERT typed by a developer. 35-06 built the write API; this is where a human reaches it.
 *
 * <h2>Rupees in, paisa out — and the rates are never touched</h2>
 *
 * Amounts are collected in rupees and converted once, at submit. Rates are NOT converted and NOT
 * arithmetic'd: a rate typed as `11.500` is sent as the number 11.5 and applied by the server
 * through `BigDecimal` with HALF_UP. `TaxSlab.ratePct` was a Java `double` until recently, and the
 * income-tax slab rate is the single largest deduction on a payslip — doing any client-side
 * arithmetic on it would put the defect back on the other side of the wire.
 *
 * <h2>The four structural rules are the server's, and its messages land on the row</h2>
 *
 * A gap, an overlap, a first band above zero and a missing or duplicated open top each produce a
 * payslip that is right for most salaries and wrong for a band. The server validates all four and
 * reports EVERY offending row at once, at `slabs.{n}.minPaisa` / `slabs.{n}.maxPaisa`. Those paths
 * bind straight to the rows below via `applyServerFieldErrors` — which is why the field array is
 * named `slabs` and its money fields keep their `paisa` names in the form as `*Rupees` siblings
 * mapped explicitly, rather than being renamed.
 */

const bandSchema = z.object({
  minRupees: z
    .string()
    .trim()
    .min(1, "Enter the income this band starts at")
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Rupees only"),
  /** Empty means open-ended. Exactly one band may leave it empty, and the server checks that. */
  maxRupees: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "Rupees only, or leave blank for the top band"),
  baseTaxRupees: z
    .string()
    .trim()
    .min(1, "Enter the fixed tax for this band (0 if none)")
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Rupees only"),
  ratePct: z
    .string()
    .trim()
    .min(1, "Enter a rate (0 if this band is untaxed)")
    .refine((v) => /^\d{1,3}(\.\d{1,3})?$/.test(v), "A percentage, up to three decimal places")
    .refine((v) => Number(v) <= 100, "A rate cannot exceed 100%"),
});

const percent = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label} (0 if there is none)`)
    .refine((v) => /^\d{1,3}(\.\d{1,3})?$/.test(v), "A percentage, up to three decimal places")
    .refine((v) => Number(v) <= 100, "A rate cannot exceed 100%");

const rupees = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}`)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Rupees only");

const taxConfigFormSchema = z.object({
  effectiveFrom: z.string().min(1, "Choose the date this takes effect"),
  effectiveTo: z.string(),
  slabs: z.array(bandSchema).min(1, "A tax table needs at least one income band"),
  surchargeThresholdRupees: rupees("income at which surcharge starts"),
  surchargeRatePct: percent("surcharge rate"),
  eobiEmployerRatePct: percent("employer EOBI rate"),
  eobiEmployeeRatePct: percent("employee EOBI rate"),
  eobiWageBaseRupees: rupees("wage the EOBI contribution is calculated on"),
  active: z.boolean(),
});

type TaxConfigFormValues = z.infer<typeof taxConfigFormSchema>;

const toRupees = (paisa: number) => (paisa / 100).toFixed(2);
const toPaisa = (r: string) => Math.round(Number(r) * 100);

export function TaxConfigForm({
  fiscalYear,
  existing,
  draft,
}: {
  fiscalYear: number;
  /** The saved configuration for this year, if any. */
  existing?: TaxConfig;
  /** A carried-forward draft from a previous year. Never saved until the accountant saves it. */
  draft?: TaxConfigFormValues;
}) {
  const saveTaxConfig = useSaveTaxConfig();

  const form = useStandardForm<TaxConfigFormValues>({
    schema: taxConfigFormSchema,
    defaultValues: draft ?? defaultsFor(fiscalYear, existing),
  });

  const { reset } = form;
  React.useEffect(() => {
    reset(draft ?? defaultsFor(fiscalYear, existing));
  }, [fiscalYear, existing, draft, reset]);

  const bands = useFieldArray({ control: form.control, name: "slabs" });

  function onSubmit(values: TaxConfigFormValues) {
    saveTaxConfig.mutate(
      {
        fiscalYear,
        input: {
          effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo || null,
          slabs: values.slabs.map((b) => ({
            minPaisa: toPaisa(b.minRupees),
            // null, not 0: an empty upper limit is the OPEN-ENDED top band, and sending 0 would
            // make it a band that ends where it starts — refused, correctly, for a different reason
            // than the one the accountant would be looking for.
            maxPaisa: b.maxRupees === "" ? null : toPaisa(b.maxRupees),
            baseTaxPaisa: toPaisa(b.baseTaxRupees),
            // Sent as written. No rounding, no scaling — see the class comment.
            ratePct: Number(b.ratePct),
          })),
          surchargeThresholdPaisa: toPaisa(values.surchargeThresholdRupees),
          surchargeRatePct: Number(values.surchargeRatePct),
          eobiEmployerRatePct: Number(values.eobiEmployerRatePct),
          eobiEmployeeRatePct: Number(values.eobiEmployeeRatePct),
          eobiWageBasePaisa: toPaisa(values.eobiWageBaseRupees),
          prorationMethod: "CALENDAR_DAYS",
          active: values.active,
        },
      },
      {
        onSuccess: () => toast.success(`FY${fiscalYear} tax table saved`),
        onError: (error) => {
          // The server reports every bad band at once, each at slabs.{n}.{field}. Those paths are
          // exactly the field-array paths below, so each message lands on its own row.
          const applied = applyServerFieldErrors(form, error, SERVER_TO_FORM_FIELDS);
          if (!applied.hasFieldErrors) {
            toast.error(form.formState.errors.root?.message ?? "Could not save this tax table");
          }
        },
      },
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="effectiveFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Effective from</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="effectiveTo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Effective to</FormLabel>
                <FormHint>Optional</FormHint>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Income bands</h2>
              <p className="text-muted-foreground text-sm">
                Bands must start at 0 and run without gaps or overlaps, and the highest band must
                have no upper limit — leave its “up to” blank.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                bands.append({ minRupees: "", maxRupees: "", baseTaxRupees: "0", ratePct: "0" })
              }
            >
              Add band
            </Button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1">From (Rs)</th>
                <th>Up to (Rs)</th>
                <th>Fixed tax (Rs)</th>
                <th>Rate %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bands.fields.map((band, index) => (
                <tr key={band.id} className="border-b align-top">
                  {(["minRupees", "maxRupees", "baseTaxRupees", "ratePct"] as const).map((name) => (
                    <td key={name} className="py-1 pr-2">
                      <FormField
                        control={form.control}
                        name={`slabs.${index}.${name}` as const}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="sr-only">
                              {`Band ${index + 1} ${BAND_LABELS[name]}`}
                            </FormLabel>
                            <FormControl>
                              <Input
                                inputMode="decimal"
                                placeholder={name === "maxRupees" ? "no limit" : undefined}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </td>
                  ))}
                  <td className="py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => bands.remove(index)}
                      aria-label={`Remove band ${index + 1}`}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="surchargeThresholdRupees"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Surcharge starts above</FormLabel>
                <FormHint>Annual taxable income, in rupees</FormHint>
                <FormControl>
                  <Input inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="surchargeRatePct"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Surcharge rate %</FormLabel>
                <FormHint>Applied to the tax payable, not to income</FormHint>
                <FormControl>
                  <Input inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eobiEmployerRatePct"
            render={({ field }) => (
              <FormItem>
                <FormLabel>EOBI employer %</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eobiEmployeeRatePct"
            render={({ field }) => (
              <FormItem>
                <FormLabel>EOBI employee %</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eobiWageBaseRupees"
            render={({ field }) => (
              <FormItem>
                <FormLabel>EOBI wage base</FormLabel>
                <FormHint>The statutory minimum wage the contribution is figured on</FormHint>
                <FormControl>
                  <Input inputMode="decimal" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem>
                <FormLabel>In force</FormLabel>
                <FormHint>
                  Payroll refuses a year that is not in force exactly as it refuses one that does
                  not exist — a half-entered table is never silently applied.
                </FormHint>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {form.formState.errors.root ? (
          <p role="alert" className="text-destructive text-sm">
            {form.formState.errors.root.message}
          </p>
        ) : null}

        <FormSubmitButton submitState={form.submitState}>Save FY{fiscalYear}</FormSubmitButton>
      </form>
    </Form>
  );
}

const BAND_LABELS = {
  minRupees: "starts at",
  maxRupees: "ends at",
  baseTaxRupees: "fixed tax",
  ratePct: "rate",
} as const;

/**
 * The server names a band's bounds in paisa (`slabs.2.minPaisa`); the form collects rupees
 * (`slabs.2.minRupees`). Mapping is the documented alternative to renaming a field — see
 * `applyServerFieldErrors`'s `fieldMap` argument. It is index-agnostic because the binder resolves
 * each path against the form's values after substitution.
 */
const SERVER_TO_FORM_FIELDS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [
    [`slabs.${i}.minPaisa`, `slabs.${i}.minRupees`],
    [`slabs.${i}.maxPaisa`, `slabs.${i}.maxRupees`],
    [`slabs.${i}.baseTaxPaisa`, `slabs.${i}.baseTaxRupees`],
  ]).flat(),
);

function defaultsFor(fiscalYear: number, existing: TaxConfig | undefined): TaxConfigFormValues {
  if (!existing) {
    return {
      // The Pakistani fiscal year runs 1 July to 30 June and is named for the year it ENDS in, so
      // FY2027 begins on 1 July 2026. These are prefilled rather than blank because they are
      // derivable and typing them is an opportunity to get the boundary wrong.
      effectiveFrom: `${fiscalYear - 1}-07-01`,
      effectiveTo: `${fiscalYear}-06-30`,
      slabs: [{ minRupees: "0", maxRupees: "", baseTaxRupees: "0", ratePct: "0" }],
      surchargeThresholdRupees: "0",
      surchargeRatePct: "0",
      eobiEmployerRatePct: "0",
      eobiEmployeeRatePct: "0",
      eobiWageBaseRupees: "0",
      active: false,
    };
  }
  return {
    effectiveFrom: existing.effectiveFrom,
    effectiveTo: existing.effectiveTo ?? "",
    slabs: existing.slabs.map((s) => ({
      minRupees: toRupees(s.minPaisa),
      maxRupees: s.maxPaisa == null ? "" : toRupees(s.maxPaisa),
      baseTaxRupees: toRupees(s.baseTaxPaisa),
      ratePct: String(s.ratePct),
    })),
    surchargeThresholdRupees: toRupees(existing.surchargeThresholdPaisa),
    surchargeRatePct: String(existing.surchargeRatePct),
    eobiEmployerRatePct: String(existing.eobiEmployerRatePct),
    eobiEmployeeRatePct: String(existing.eobiEmployeeRatePct),
    eobiWageBaseRupees: toRupees(existing.eobiWageBasePaisa),
    active: existing.active,
  };
}

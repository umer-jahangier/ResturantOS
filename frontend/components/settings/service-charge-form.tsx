"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useServiceChargePolicy, useUpdateServiceCharge } from "@/lib/hooks/pos/use-service-charge";
import { formatUserFacingError } from "@/lib/errors";
import type { ServiceChargePolicy } from "@/lib/models/service-charge.model";

/**
 * A branch's service charge — the control the product has never had (F20).
 *
 * <h3>What was actually wrong</h3>
 *
 * <p>`orders.service_charge_paisa` has existed since the first POS migration. It is summed by the
 * takings report, carried on ORDER_CLOSED, credited to account 4910 by finance, printed by the
 * receipt assembler and rendered on the charge page. Every consumer was built. Nothing in the
 * product could make the number move: measured on 2026-08-12, it was zero on all 195 orders, while
 * the charge page and every guest's receipt printed `Service charge Rs 0.00`.
 *
 * <h3>The preview is not decoration</h3>
 *
 * <p>A percentage is an abstraction; the number the guest argues about is rupees. The worked
 * example under the rate is computed with the same arithmetic the server uses (percent of the
 * net-of-discount, pre-tax subtotal, rounded HALF_UP to the paisa), so an owner setting 5% sees
 * what a Rs 2,000 table will actually be billed before they save.
 *
 * <h3>Read-only rather than refused</h3>
 *
 * <p>`policy.canManage` comes from the server, which owns the permission catalogue. A branch
 * MANAGER lands here with every control disabled and the rate visible, because the charge is on
 * every bill they hand a guest and being unable to look it up leaves them defending a number the
 * product hides from them.
 */

const serviceChargeSchema = z
  .object({
    enabled: z.boolean(),
    // A STRING in the form and a number at the boundary, for the same reason the charge page's
    // tender inputs are strings: `type="number"` reports `.value === ""` mid-keystroke on "5.5",
    // so a numeric field silently eats the digits after the point.
    ratePct: z.string(),
    label: z.string().min(1, "The bill needs a word for this charge").max(60, "60 characters at most"),
    dineIn: z.boolean(),
    takeaway: z.boolean(),
    pickup: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const parsed = parseRate(values.ratePct);
    if (parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratePct"],
        message: "Enter a percentage, like 5 or 12.5.",
      });
      return;
    }
    if (parsed < 0 || parsed > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratePct"],
        message: "A service charge is between 0% and 100%.",
      });
      return;
    }
    // The two rules the server also enforces, checked here so the person filling the form is told
    // before they press Save rather than by a 422 afterwards.
    if (values.enabled && parsed <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratePct"],
        message:
          "Enter a percentage above 0, or switch the service charge off. Switched on at 0% it adds a line to every guest's bill and collects nothing.",
      });
    }
    if (values.enabled && !values.dineIn && !values.takeaway && !values.pickup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dineIn"],
        message: "Choose at least one channel. With all three off the charge applies to nothing.",
      });
    }
  });

type ServiceChargeFormValues = z.infer<typeof serviceChargeSchema>;

/** Rupees the preview is worked against — an ordinary two-cover dinner check. */
const PREVIEW_BASE_PAISA = 200_000;

/**
 * `null` for anything that is not a percentage. Never `0`, and never `NaN` leaking onward: the
 * absent-vs-zero confusion is precisely what produced the tax defect V23 exists to close.
 */
export function parseRate(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The server's arithmetic, restated for the preview only — `base * rate / 100`, HALF_UP to whole
 * paisa. It computes a PREVIEW and never a charged amount: the figure on a real bill is computed
 * by `OrderPricingCalculator.serviceCharge` in BigDecimal, inside the order transaction, and this
 * screen never sends a money amount anywhere.
 */
export function previewServiceChargePaisa(basePaisa: number, ratePct: number): number {
  return Math.round((basePaisa * ratePct) / 100);
}

const EMPTY_FORM: ServiceChargeFormValues = {
  enabled: false,
  ratePct: "0",
  label: "Service charge",
  dineIn: true,
  takeaway: false,
  pickup: false,
};

function defaultsFor(policy: ServiceChargePolicy): ServiceChargeFormValues {
  return {
    enabled: policy.enabled,
    ratePct: String(policy.ratePct),
    label: policy.label,
    dineIn: policy.dineIn,
    takeaway: policy.takeaway,
    pickup: policy.pickup,
  };
}

export function ServiceChargeForm({ branchId }: { branchId: string | null }) {
  const query = useServiceChargePolicy(branchId);
  const update = useUpdateServiceCharge(branchId);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const policy = query.data;

  const form = useForm<ServiceChargeFormValues>({
    // BOTH, and each earns its place — see BranchSettingsForm: `defaultValues` keeps every input
    // controlled from the first render, `values` adopts the server's answer when it arrives.
    defaultValues: EMPTY_FORM,
    resolver: createZodResolver(serviceChargeSchema),
    ...(policy ? { values: defaultsFor(policy) } : {}),
  });

  const canManage = policy?.canManage ?? false;
  // `useWatch`, not `form.watch()`: the latter returns a function the React Compiler cannot
  // memoize, so it opts the whole component out of compilation. Same call and same reason as
  // `user-form-dialog.tsx`.
  const watchedRate = useWatch({ control: form.control, name: "ratePct" }) ?? "";
  const watchedEnabled = useWatch({ control: form.control, name: "enabled" }) ?? false;
  const previewRate = parseRate(watchedRate);
  const previewPaisa =
    watchedEnabled && previewRate !== null
      ? previewServiceChargePaisa(PREVIEW_BASE_PAISA, previewRate)
      : 0;

  function onSubmit(values: ServiceChargeFormValues) {
    const rate = parseRate(values.ratePct);
    if (rate === null) return;
    update.mutate(
      {
        enabled: values.enabled,
        ratePct: rate,
        label: values.label.trim(),
        dineIn: values.dineIn,
        takeaway: values.takeaway,
        pickup: values.pickup,
      },
      {
        onSuccess: (saved) => {
          setSavedAt(new Date().toLocaleTimeString());
          toast.success(
            saved.enabled
              ? `${saved.label} of ${saved.ratePct}% now applies to new checks.`
              : "Service charge switched off. New checks carry none.",
          );
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service charge</CardTitle>
        <CardDescription>
          A percentage added to every check at this branch, before tax. It is your money, not a
          tax — it is booked to its own revenue account and shows on the guest&apos;s bill under
          the wording you choose here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={query} what="this branch's service charge">
          {policy && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                {!canManage && (
                  <p
                    data-testid="service-charge-read-only-notice"
                    role="status"
                    className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                  >
                    You can see this branch&apos;s service charge but not change it. Changing it
                    re-prices every check in the building, so it is held by an owner or a tenant
                    administrator.
                  </p>
                )}

                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem>
                      <label className="flex items-start gap-3">
                        <FormControl>
                          <input
                            type="checkbox"
                            data-testid="service-charge-enabled"
                            checked={field.value}
                            disabled={!canManage}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="mt-1 size-4 accent-primary"
                          />
                        </FormControl>
                        <span>
                          <span className="text-sm font-medium">
                            Charge a service charge at this branch
                          </span>
                          <FormDescription>
                            Off means no service-charge line appears on the bill at all — not a
                            line reading Rs 0.00.
                          </FormDescription>
                        </span>
                      </label>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="ratePct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Percentage</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="decimal"
                            autoComplete="off"
                            data-testid="service-charge-rate"
                            disabled={!canManage}
                            placeholder="5"
                            className="text-right font-mono tabular-nums"
                          />
                        </FormControl>
                        <FormDescription>
                          Of the food and drink after any discount, before tax.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What the bill calls it</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            data-testid="service-charge-label"
                            disabled={!canManage}
                            placeholder="Service charge"
                          />
                        </FormControl>
                        <FormDescription>Printed on the guest&apos;s receipt.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Applies to</legend>
                  <p className="text-xs text-muted-foreground">
                    A service charge pays for table service. Charging a counter guest for waiting on
                    themselves is the most common way a restaurant gets this wrong in public.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {(
                      [
                        ["dineIn", "Dine-in"],
                        ["takeaway", "Takeaway"],
                        ["pickup", "Pickup"],
                      ] as const
                    ).map(([name, caption]) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem className="flex-none">
                            <label className="flex items-center gap-2">
                              <FormControl>
                                <input
                                  type="checkbox"
                                  data-testid={`service-charge-${name}`}
                                  checked={field.value}
                                  disabled={!canManage}
                                  onChange={(e) => field.onChange(e.target.checked)}
                                  className="size-4 accent-primary"
                                />
                              </FormControl>
                              <span className="text-sm">{caption}</span>
                            </label>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage>{form.formState.errors.dineIn?.message}</FormMessage>
                </fieldset>

                <div
                  data-testid="service-charge-preview"
                  data-paisa={previewPaisa}
                  className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    On a <MoneyDisplay paisa={PREVIEW_BASE_PAISA} className="font-mono" /> check
                    this branch adds{" "}
                  </span>
                  <MoneyDisplay paisa={previewPaisa} className="font-mono font-semibold" />
                  <span className="text-muted-foreground">
                    {watchedEnabled ? "" : " — the charge is switched off"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    data-testid="service-charge-save"
                    disabled={!canManage || update.isPending}
                  >
                    {update.isPending ? "Saving…" : "Save service charge"}
                  </Button>
                  {savedAt && (
                    <span data-testid="service-charge-saved-at" className="text-xs text-muted-foreground">
                      Saved at {savedAt}
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  A change applies to checks from now on. A check already presented to a guest keeps
                  the rate it was rung at, and a bill reprinted next year still shows what they
                  actually paid.
                </p>
              </form>
            </Form>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

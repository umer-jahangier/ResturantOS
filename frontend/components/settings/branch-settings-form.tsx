"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useBranchSettings, useUpdateBranchSettings } from "@/lib/hooks/use-tenant-settings";
import { formatUserFacingError } from "@/lib/errors";
import type { BranchSettings, BranchSettingsPatch } from "@/lib/models/tenant-settings.model";

/**
 * Branch details — the part of Settings that genuinely persists.
 *
 * <h3>Why this form exists in this shape</h3>
 *
 * The platform has no tenant-settings API. Measured as TENANT_ADMIN through the real gateway:
 * `/api/v1/tenant-profile`, `/api/v1/tenants/{id}/settings`, `/api/v1/tenants/{id}/theme`,
 * `/api/v1/settings` and `/api/v1/onboarding` all answer <b>404</b>. `PUT /api/v1/branches/{id}`
 * answers <b>200</b> and stores what it is given.
 *
 * <p>So this screen is built on the endpoint that works, and the fields it cannot store are not
 * offered as inputs. `fbrStrn` and `ntn` are shown read-only with the reason, because
 * `BranchDtos.UpdateBranchRequest` declares no field for either: an editable box the API silently
 * drops is the defect this phase exists to remove, not a smaller version of it.
 *
 * <h3>Only what changed is sent</h3>
 *
 * `BranchService.update` applies each field only when non-null, so an omitted key means "leave it
 * alone". Submitting a full snapshot would turn every untouched field into a write and would revert
 * a concurrent edit made from another browser between load and save.
 */

const branchSchema = z.object({
  name: z.string().min(1, "A branch needs a name").max(150, "150 characters at most"),
  address: z.string(),
  phone: z.string(),
  email: z
    .string()
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
  timezone: z.string(),
  openedOn: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use the date picker"),
});

type BranchFormValues = z.infer<typeof branchSchema>;

/** Every key present and a string, so no input is ever mounted holding `undefined`. */
const EMPTY_FORM: BranchFormValues = {
  name: "",
  address: "",
  phone: "",
  email: "",
  timezone: "",
  openedOn: "",
};

function defaultsFor(branch: BranchSettings): BranchFormValues {
  return {
    name: branch.name,
    address: branch.address ?? "",
    phone: branch.phone ?? "",
    email: branch.email ?? "",
    timezone: branch.timezone ?? "",
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

export function BranchSettingsForm({ branchId }: { branchId: string | null }) {
  const query = useBranchSettings(branchId);
  const update = useUpdateBranchSettings(branchId);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const branch = query.data;

  const form = useForm<BranchFormValues>({
    // BOTH, and each earns its place. `defaultValues` keeps every input controlled from the very
    // first render — with `values` alone the fields mount holding `undefined` and React logs
    // "changing an uncontrolled input to be controlled" (observed in the browser, 2026-08-11).
    // `values` is what makes the form adopt the server's answer when it arrives, and again after
    // a save, instead of freezing whatever was there when it mounted.
    defaultValues: EMPTY_FORM,
    resolver: createZodResolver(branchSchema),
    ...(branch ? { values: defaultsFor(branch) } : {}),
  });

  function onSubmit(values: BranchFormValues) {
    if (!branch) return;
    const patch = changedFieldsOnly(values, branch);
    if (Object.keys(patch).length === 0) {
      toast.info("Nothing to save — no field changed.");
      return;
    }
    update.mutate(patch, {
      onSuccess: () => {
        setSavedAt(new Date().toLocaleTimeString());
        toast.success("Branch details saved.");
      },
      onError: (error) => toast.error(formatUserFacingError(error)),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch details</CardTitle>
        <CardDescription>
          Saved to your restaurant&apos;s record and visible to everyone on this branch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={query} what="this branch's details">
          {branch && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch name</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Street, area, city" />
                      </FormControl>
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
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input {...field} inputMode="tel" />
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
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time zone</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Asia/Karachi" />
                        </FormControl>
                        <FormDescription>
                          An IANA name. Business dates and reports are cut on it.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="openedOn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opened on</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 rounded-md border border-dashed p-3 sm:grid-cols-2">
                  <div className="space-y-0.5">
                    <p className="text-label text-muted-foreground">Sales tax registration (STRN)</p>
                    <p className="text-small">{branch.fbrStrn ?? "Not set"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-label text-muted-foreground">National tax number (NTN)</p>
                    <p className="text-small">{branch.ntn ?? "Not set"}</p>
                  </div>
                  <p className="text-label text-muted-foreground sm:col-span-2">
                    Read-only here. The branch update API has no field for either, so an editable
                    box would accept your change and discard it. Tax registration is set during
                    onboarding.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={update.isPending}>
                    {update.isPending ? "Saving…" : "Save changes"}
                  </Button>
                  {savedAt && (
                    <span role="status" className="text-small text-muted-foreground">
                      Saved at {savedAt}
                    </span>
                  )}
                </div>
              </form>
            </Form>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

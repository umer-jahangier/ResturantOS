"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateStation, useUpdateStation } from "@/lib/hooks/pos/use-station-admin";
import type { Station, StationType } from "@/lib/models/pos.model";
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
import { StationTypeSelect } from "@/components/stations/station-type-select";

/**
 * Create and edit a station.
 *
 * <h3>The code is upper-cased, and immutable after creation</h3>
 *
 * The code is the routing key: it rides every fired ticket, it is the KDS WebSocket
 * subscription key, and it is what a user's station assignment stores. pos-service stores it
 * verbatim while auth-service upper-cases an assignment's codes, and the KDS scope compares the
 * two with `IN` — so a station created as `bar` would never match an assignment stored as `BAR`,
 * and the only symptom would be a bartender staring at an empty board. Upper-casing on the way in
 * removes the mismatch rather than documenting it.
 *
 * <p>pos-service refuses to change a code on update (renaming a routing key orphans in-flight
 * tickets), so the field is shown read-only in edit mode rather than hidden — an admin looking
 * for it should find it and see why, not conclude the screen forgot it.
 */

const CODE_PATTERN = /^[A-Z0-9_-]+$/;

const stationFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Give the station a short code")
    .max(50, "Keep the code to 50 characters")
    .transform((v) => v.toUpperCase())
    .refine(
      (v) => CODE_PATTERN.test(v),
      "Use letters, numbers, hyphens and underscores only — the code is a routing key, not a label",
    ),
  name: z
    .string()
    .trim()
    .min(1, "Give the station a name staff will recognise")
    .max(100, "Keep the name to 100 characters"),
  stationType: z.enum(["KITCHEN", "BAR", "PANTRY", "EXPO", "DESSERT"]),
});

type StationFormValues = z.input<typeof stationFormSchema>;
type StationFormOutput = z.output<typeof stationFormSchema>;

function defaultsFor(station: Station | undefined): StationFormValues {
  if (!station) return { code: "", name: "", stationType: "KITCHEN" };
  return { code: station.code, name: station.name, stationType: station.stationType };
}

export function StationFormDialog({
  station,
  open,
  onOpenChange,
}: {
  /** Present → edit that station. Absent → create. */
  station?: Station;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createStation = useCreateStation();
  const updateStation = useUpdateStation();
  const isEdit = station !== undefined;
  const isPending = createStation.isPending || updateStation.isPending;

  const form = useForm<StationFormValues, unknown, StationFormOutput>({
    resolver: createZodResolver(stationFormSchema),
    defaultValues: defaultsFor(station),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(station));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, station?.id]);

  function onSubmit(values: StationFormOutput) {
    if (isEdit && station) {
      updateStation.mutate(
        {
          id: station.id,
          // `active` is round-tripped rather than assumed true: editing a retired station from
          // the catalogue must not silently restore it. Restoring is its own action.
          input: { name: values.name, active: station.active, stationType: values.stationType },
        },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError: (error) =>
            toast.error(error.message || "Could not update the station. Please try again."),
        },
      );
      return;
    }

    createStation.mutate(
      { code: values.code, name: values.name, stationType: values.stationType },
      {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name}`);
          onOpenChange(false);
        },
        // The duplicate-code refusal arrives as the server's own sentence naming the code —
        // show it, it is the actionable one. A generic "could not save" would leave an admin
        // retyping a code that will be refused again for the same reason.
        onError: (error) =>
          toast.error(error.message || "Could not add the station. Please try again."),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit station" : "Add station"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "The code cannot change — it is what fired tickets and live screens are routed by."
              : "A station is where a ticket goes. Its type decides which screen it appears on."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="station-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="The routing key. It travels on every ticket fired to this station and is what a staff member's station assignment refers to. Stored in upper case.">
                    Code
                  </FieldLabel>
                  <FormControl>
                    <Input
                      placeholder="BAR"
                      autoComplete="off"
                      readOnly={isEdit}
                      aria-readonly={isEdit}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
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
                  <FieldLabel help="What staff call this station — “Main bar”, “Grill”, “Cold pass”.">
                    Name
                  </FieldLabel>
                  <FormControl>
                    <Input placeholder="Main bar" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="stationType"
              render={({ field }) => (
                <FormItem>
                  <FieldLabel help="Which screen this station's tickets appear on. Five types share three screens — a dessert station is still on the kitchen screen.">
                    Type
                  </FieldLabel>
                  <StationTypeSelect
                    id="station-type"
                    value={field.value as StationType}
                    onChange={field.onChange}
                  />
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
          <Button type="submit" form="station-form" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add station"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

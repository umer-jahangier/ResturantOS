"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import {
  useCreateStorageLocation,
  useUpdateStorageLocation,
} from "@/lib/hooks/inventory/use-inventory";
import type { StorageLocation } from "@/lib/adapters/inventory.adapter";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/shared/field-help";

const storageLocationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
});

type StorageLocationFormValues = z.infer<typeof storageLocationFormSchema>;

function defaultsFor(location?: StorageLocation): StorageLocationFormValues {
  return {
    name: location?.name ?? "",
    description: location?.description ?? "",
  };
}

interface StorageLocationFormDialogProps {
  /** Absent = create; present = edit that location. */
  location?: StorageLocation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create-or-edit a storage location. Fully controlled (no `trigger`) because both entry points —
 * the header button and a row's Edit action — already have their own buttons, mirroring how the
 * categories page drives {@code CategoryFormDialog}.
 */
export function StorageLocationFormDialog({
  location,
  open,
  onOpenChange,
}: StorageLocationFormDialogProps) {
  const isEdit = location !== undefined;
  const createLocation = useCreateStorageLocation();
  const updateLocation = useUpdateStorageLocation();
  const mutation = isEdit ? updateLocation : createLocation;

  const form = useForm<StorageLocationFormValues>({
    resolver: createZodResolver(storageLocationFormSchema),
    defaultValues: defaultsFor(location),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(location));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSubmit(values: StorageLocationFormValues) {
    const input = {
      name: values.name.trim(),
      description: values.description.trim() || undefined,
    };
    const onError = (error: { message?: string }) => {
      // A duplicate name comes back as 422 STORAGE_LOCATION_DUPLICATE naming the existing row —
      // surface the server's sentence rather than a generic one, since it says which shelf it
      // already is.
      toast.error(error.message || "Could not save the storage location. Please try again.");
    };

    if (isEdit) {
      updateLocation.mutate(
        { id: location.id, input },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      createLocation.mutate(input, {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name}`);
          onOpenChange(false);
        },
        onError,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit storage location" : "Add storage location"}</DialogTitle>
          <DialogDescription>
            Where stock physically lives. Renaming one updates every ingredient filed there.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="storage-location-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Walk-in Cooler" {...field} />
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
                  <FieldLabel help="Optional detail — the temperature it runs at, or which door it’s behind.">
                    Description
                  </FieldLabel>
                  <FormControl>
                    <Input placeholder="Optional — e.g. Chilled, 2–4°C" {...field} />
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
          <Button type="submit" form="storage-location-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

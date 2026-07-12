"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCreateVendor, useUpdateVendor } from "@/lib/hooks/purchasing/use-purchasing";
import type { Vendor, VendorInput } from "@/lib/adapters/purchasing.adapter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

// Every field is a string here because that is what an <input> yields; the numeric and
// optional fields are narrowed to VendorInput in toVendorInput() on submit.
const vendorFormSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  paymentTerms: z.string().min(1, "Payment terms are required"),
  contactPerson: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string(),
  ntn: z.string(),
  strn: z.string(),
  leadTimeDays: z.string().refine((v) => v === "" || /^\d+$/.test(v), "Enter a whole number of days"),
  bankAccountNo: z.string(),
  notes: z.string(),
});

type VendorFormValues = z.infer<typeof vendorFormSchema>;

function toVendorInput(values: VendorFormValues): VendorInput {
  const trimmed = (v: string) => {
    const t = v.trim();
    return t === "" ? undefined : t;
  };
  return {
    name: values.name.trim(),
    paymentTerms: values.paymentTerms.trim(),
    contactPerson: trimmed(values.contactPerson),
    phone: trimmed(values.phone),
    email: trimmed(values.email),
    address: trimmed(values.address),
    ntn: trimmed(values.ntn),
    strn: trimmed(values.strn),
    leadTimeDays: values.leadTimeDays.trim() === "" ? undefined : Number(values.leadTimeDays),
    // Omitted when blank so an edit never wipes the stored encrypted account.
    bankAccountNo: trimmed(values.bankAccountNo),
    notes: trimmed(values.notes),
  };
}

function defaultsFor(vendor?: Vendor): VendorFormValues {
  return {
    name: vendor?.name ?? "",
    paymentTerms: vendor?.paymentTerms ?? "",
    contactPerson: vendor?.contactPerson ?? "",
    phone: vendor?.phone ?? "",
    email: vendor?.email ?? "",
    address: vendor?.address ?? "",
    ntn: vendor?.ntn ?? "",
    strn: vendor?.strn ?? "",
    leadTimeDays: vendor?.leadTimeDays == null ? "" : String(vendor.leadTimeDays),
    bankAccountNo: "",
    notes: vendor?.notes ?? "",
  };
}

interface VendorFormDialogProps {
  /** Absent = create a new vendor; present = edit that vendor. */
  vendor?: Vendor;
  trigger: React.ReactNode;
}

/** PUR-01: the manager-facing create/edit vendor form. */
export function VendorFormDialog({ vendor, trigger }: VendorFormDialogProps) {
  const [open, setOpen] = useState(false);
  const isEdit = vendor !== undefined;

  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor(vendor?.id ?? "");
  const mutation = isEdit ? updateVendor : createVendor;

  const form = useForm<VendorFormValues>({
    resolver: createZodResolver(vendorFormSchema),
    defaultValues: defaultsFor(vendor),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Reset on every open so an edit dialog always reflects the current vendor, and a
    // create dialog never retains the previous attempt's values.
    if (next) form.reset(defaultsFor(vendor));
  }

  function onSubmit(values: VendorFormValues) {
    mutation.mutate(toVendorInput(values), {
      onSuccess: (saved) => {
        toast.success(isEdit ? `Updated ${saved.name}` : `Added ${saved.name}`);
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not save the vendor. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit vendor" : "Add vendor"}</DialogTitle>
          <DialogDescription>
            The bank account is encrypted at rest — only the last four digits are ever shown.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="vendor-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Fresh Foods Ltd" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentTerms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment terms</FormLabel>
                  <FormControl>
                    <Input placeholder="NET30" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="leadTimeDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead time (days)</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="7" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contactPerson"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact person</FormLabel>
                  <FormControl>
                    <Input placeholder="Ali" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input inputMode="tel" placeholder="03001234567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="orders@vendor.pk" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="12 Mall Road, Lahore" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ntn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>NTN</FormLabel>
                  <FormControl>
                    <Input placeholder="1234567-8" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="strn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>STRN</FormLabel>
                  <FormControl>
                    <Input placeholder="0300012345678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bankAccountNo"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Bank account number</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder={
                        isEdit && vendor?.bankAccountLast4
                          ? `•••• ${vendor.bankAccountLast4} — leave blank to keep`
                          : "PK36SCBL0000001123456702"
                      }
                      aria-describedby="bank-hint"
                      {...field}
                    />
                  </FormControl>
                  <p id="bank-hint" className="text-sm text-muted-foreground">
                    {isEdit
                      ? "Enter a new number only to replace the stored account."
                      : "Stored encrypted; the list will show only the last four digits."}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Delivers Mon/Thu only" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add vendor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useCreateTerminal, useUpdateTerminal } from "@/lib/hooks/pos/use-terminal-admin";
import type { PosTerminal, ServiceModel, TerminalOrderType } from "@/lib/models/terminal.model";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MenuScopePicker } from "@/components/terminals/menu-scope-picker";
import { StationSetPicker } from "@/components/terminals/station-set-picker";

/**
 * Create and edit a POS terminal profile (D-28-03).
 *
 * <p>Not a react-hook-form dialog: two of the four controls are multi-selects over server lists,
 * and the validation this form needs is one non-empty name and one code shape. The labels are
 * therefore wired with explicit `htmlFor`/`id` pairs rather than inherited from `FormItem` — 19b's
 * lesson about a control that is deliberately not a form-library field.
 *
 * <p>The CODE is immutable after creation. A browser session on a till remembers which terminal it
 * is by that handle (plan 28-13), so renaming it would silently re-point every screen that stored
 * it. Shown read-only on edit rather than hidden, so an admin looking for it finds it and sees why.
 */

const SERVICE_MODEL_OPTIONS: { value: ServiceModel; label: string; hint: string }[] = [
  { value: "COUNTER", label: "Counter", hint: "Order and pay at the till." },
  { value: "TABLE_SERVICE", label: "Table service", hint: "Orders are opened against a table." },
  { value: "SELF_SERVE", label: "Self serve", hint: "The customer rings up their own order." },
];

const ORDER_TYPE_OPTIONS: { value: TerminalOrderType; label: string }[] = [
  { value: "DINE_IN", label: "Dine in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "PICKUP", label: "Pickup" },
];

const CODE_PATTERN = /^[A-Z0-9_-]+$/;

export function TerminalFormDialog({
  terminal,
  open,
  onOpenChange,
}: {
  /** Present → edit. Absent → create. */
  terminal?: PosTerminal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createTerminal = useCreateTerminal();
  const updateTerminal = useUpdateTerminal();
  const isEdit = terminal !== undefined;
  const isPending = createTerminal.isPending || updateTerminal.isPending;

  const [code, setCode] = useState(terminal?.code ?? "");
  const [name, setName] = useState(terminal?.name ?? "");
  const [serviceModel, setServiceModel] = useState<ServiceModel>(
    terminal?.serviceModel ?? "COUNTER",
  );
  const [orderType, setOrderType] = useState<TerminalOrderType>(
    terminal?.defaultOrderType ?? "DINE_IN",
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(terminal?.categoryIds ?? []);
  const [stationIds, setStationIds] = useState<string[]>(terminal?.stationIds ?? []);
  const [error, setError] = useState<string | null>(null);

  // No reset effect. The page mounts this with a `key` derived from the form target
  // (`create` / `edit-<id>` / idle), so a change of target REMOUNTS the dialog and the state
  // initialisers above are the reset. Copying props into state inside an effect would be a second,
  // slower mechanism for the same thing — and one render behind it.

  function submit() {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName) {
      setError("Give the terminal a name staff will recognise.");
      return;
    }
    if (!isEdit && !CODE_PATTERN.test(trimmedCode)) {
      setError(
        "Use letters, numbers, hyphens and underscores for the code — it is the handle a till remembers itself by.",
      );
      return;
    }
    setError(null);

    if (isEdit && terminal) {
      updateTerminal.mutate(
        {
          id: terminal.id,
          // Both scope lists are ALWAYS sent. `null` means "leave alone" server-side, and omitting
          // them would make "the admin unticked everything" indistinguishable from a rename — one
          // of which silently widens a bar terminal to the whole card (28-04).
          input: {
            name: trimmedName,
            serviceModel,
            defaultOrderType: orderType,
            categoryIds,
            stationIds,
          },
        },
        {
          onSuccess: (saved) => {
            toast.success(`Updated ${saved.name}`);
            onOpenChange(false);
          },
          onError: (e) => setError(e.message || "Could not update the terminal. Please try again."),
        },
      );
      return;
    }

    createTerminal.mutate(
      {
        code: trimmedCode,
        name: trimmedName,
        serviceModel,
        defaultOrderType: orderType,
        categoryIds,
        stationIds,
      },
      {
        onSuccess: (saved) => {
          toast.success(`Added ${saved.name}`);
          onOpenChange(false);
        },
        // The duplicate-code refusal arrives as the server's own sentence naming the code. Shown
        // inline rather than as a toast because the field that has to change is on this form.
        onError: (e) => setError(e.message || "Could not add the terminal. Please try again."),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit terminal" : "Add POS terminal"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "The code cannot change — a till remembers which terminal it is by it."
              : "A terminal is a named till: what it offers, and where its orders fire to."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="terminal-code" className="text-small font-medium">
              Code
            </label>
            <Input
              id="terminal-code"
              placeholder="BAR1"
              autoComplete="off"
              readOnly={isEdit}
              aria-readonly={isEdit}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <p className="text-label text-muted-foreground">
              The handle a browser on this till remembers itself by. Set once, never changed.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="terminal-name" className="text-small font-medium">
              Name
            </label>
            <Input
              id="terminal-name"
              placeholder="Bar till"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="terminal-service-model" className="text-small font-medium">
                Service model
              </label>
              <select
                id="terminal-service-model"
                data-testid="terminal-service-model"
                value={serviceModel}
                onChange={(e) => setServiceModel(e.target.value as ServiceModel)}
                className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-small transition-colors focus-visible:border-ring dark:bg-surface-2"
              >
                {SERVICE_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-label text-muted-foreground">
                {SERVICE_MODEL_OPTIONS.find((o) => o.value === serviceModel)?.hint}
              </p>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="terminal-order-type" className="text-small font-medium">
                Default order type
              </label>
              <select
                id="terminal-order-type"
                data-testid="terminal-order-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as TerminalOrderType)}
                className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-small transition-colors focus-visible:border-ring dark:bg-surface-2"
              >
                {ORDER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-label text-muted-foreground">What a new order starts as here.</p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <p className="text-small font-medium">Menu it offers</p>
            <MenuScopePicker value={categoryIds} onChange={setCategoryIds} />
          </div>

          <div className="grid gap-1.5">
            <p className="text-small font-medium">Stations it fires to</p>
            <StationSetPicker value={stationIds} onChange={setStationIds} />
          </div>

          {error ? (
            <p
              role="alert"
              data-testid="terminal-form-error"
              className="text-small text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Add terminal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

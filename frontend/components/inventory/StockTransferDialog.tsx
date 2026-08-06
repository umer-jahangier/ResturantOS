"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import {
  useIngredients,
  usePendingTransfers,
  useReceiveTransfer,
  useShipTransfer,
} from "@/lib/hooks/inventory/use-inventory";
import type { Transfer } from "@/lib/adapters/inventory.adapter";
import {
  CatalogItemCombobox,
  type CatalogItemOption,
} from "@/components/shared/catalog-item-combobox";
import { SectionSwitcher } from "@/components/shared/section-switcher";
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
import { EmptyState } from "@/components/ui/empty-state";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Every numeric field is a string here because that is what an <input> yields; conversion to the
// wire shape (CreateTransferInput) happens in onSubmitShip.
const shipLineFormSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient is required"),
  qty: z.string().refine((v) => v.trim() !== "" && Number(v) > 0, "Enter a positive quantity"),
});

const shipFormSchema = z.object({
  toBranchId: z.string().min(1, "Destination branch is required"),
  lines: z.array(shipLineFormSchema).min(1, "Add at least one ingredient line"),
});

type ShipFormValues = z.infer<typeof shipFormSchema>;

const EMPTY_SHIP_LINE = { ingredientId: "", qty: "" };

function shipDefaults(): ShipFormValues {
  return { toBranchId: "", lines: [EMPTY_SHIP_LINE] };
}

/** A small threshold — any nonzero variance takes the warning wash; a value that has gone
 * negative (impossible to submit for a receive line, whose backend contract is
 * `@PositiveOrZero`, but visible while a manager is still typing) takes the destructive wash
 * immediately. Same rule StockCountDialog.tsx uses, per UI-SPEC Screen 7's shared contract. */
function varianceRowClassName(varianceQty: number, receivedOrCounted: number): string | undefined {
  if (receivedOrCounted < 0) return "bg-destructive/10";
  if (Math.abs(varianceQty) > 0) return "bg-warning/10";
  return undefined;
}

interface StockTransferDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * INV-15 (Screen 7 / INV-05): Ship and Receive, toggled via `SectionSwitcher`. Ship posts
 * `TransferDtos.CreateTransferRequest` (destination branch + lines) in one call. Receive lists
 * transfers SHIPPED to this branch (`GET /api/v1/inventory/transfers/pending` — a backend
 * addition this plan makes; no list endpoint existed before, only ship/receive writes) and opens
 * a confirm-and-adjust form per transfer whose per-line variance (received − shipped) is live.
 */
export function StockTransferDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: StockTransferDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const [section, setSection] = useState<"ship" | "receive">("ship");
  const [receivingTransfer, setReceivingTransfer] = useState<Transfer | null>(null);
  const [receivedQtyByIngredient, setReceivedQtyByIngredient] = useState<Record<string, string>>(
    {},
  );
  // Tracks the dialog's previous open state — see StockCountDialog.tsx's identical comment for
  // why this is a render-time reset rather than `useEffect` + `setState`.
  const [lastOpen, setLastOpen] = useState(open);

  const { branchId } = useCurrentUser();
  const { data: branches } = useMyBranches();
  const { data: ingredients } = useIngredients();
  const { data: pendingTransfers, isLoading: pendingLoading } = usePendingTransfers();
  const shipTransfer = useShipTransfer();
  const receiveTransfer = useReceiveTransfer();

  const form = useForm<ShipFormValues>({
    resolver: createZodResolver(shipFormSchema),
    defaultValues: shipDefaults(),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      form.reset(shipDefaults());
      setSection("ship");
      setReceivingTransfer(null);
      setReceivedQtyByIngredient({});
    }
  }

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const ingredientOptions: CatalogItemOption[] = (ingredients ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    secondary: i.categoryName ?? undefined,
    sku: i.sku ?? undefined,
  }));
  const destinationBranches = (branches ?? []).filter((b) => b.id !== branchId);

  function ingredientName(id: string): string {
    return ingredients?.find((i) => i.id === id)?.name ?? id;
  }

  function onSubmitShip(values: ShipFormValues) {
    shipTransfer.mutate(
      {
        fromBranchId: branchId,
        toBranchId: values.toBranchId,
        lines: values.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty.trim() })),
      },
      {
        onSuccess: () => {
          toast.success("Transfer shipped");
          form.reset(shipDefaults());
        },
        onError: (error) => {
          toast.error(error.message || "Could not ship the transfer. Please try again.");
        },
      },
    );
  }

  function openReceive(transfer: Transfer) {
    setReceivingTransfer(transfer);
    const initial: Record<string, string> = {};
    for (const line of transfer.lines) {
      initial[line.ingredientId] = line.qtyShipped;
    }
    setReceivedQtyByIngredient(initial);
  }

  function submitReceive() {
    if (!receivingTransfer) return;
    receiveTransfer.mutate(
      {
        transferId: receivingTransfer.transferId,
        lines: receivingTransfer.lines.map((line) => ({
          ingredientId: line.ingredientId,
          qtyReceived: (receivedQtyByIngredient[line.ingredientId] ?? "0").trim() || "0",
        })),
      },
      {
        onSuccess: () => {
          toast.success("Transfer received");
          setReceivingTransfer(null);
        },
        onError: (error) => {
          toast.error(error.message || "Could not receive the transfer. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock transfer</DialogTitle>
          <DialogDescription>
            Ship stock to another branch, or receive an in-transit transfer.
          </DialogDescription>
        </DialogHeader>

        <SectionSwitcher
          sections={[
            { id: "ship", label: "Ship" },
            { id: "receive", label: "Receive" },
          ]}
          activeId={section}
          onChange={(id) => setSection(id as "ship" | "receive")}
          ariaLabel="Transfer direction"
        />

        {section === "ship" ? (
          <Form {...form}>
            <form
              id="transfer-ship-form"
              onSubmit={form.handleSubmit(onSubmitShip)}
              className="grid max-h-[55vh] gap-4 overflow-y-auto"
              noValidate
            >
              <FormField
                control={form.control}
                name="toBranchId"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel help="Where the stock is going. It leaves here now and arrives when they confirm it.">
                      Destination branch
                    </FieldLabel>
                    <FormControl>
                      <select {...field} aria-label="Destination branch" className={selectClass}>
                        <option value="">Select a branch…</option>
                        {destinationBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Lines</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(EMPTY_SHIP_LINE)}
                  >
                    Add line
                  </Button>
                </div>

                {fields.map((f, idx) => (
                  <div
                    key={f.id}
                    className="grid grid-cols-[2fr_1fr_auto] items-end gap-2 rounded border p-2"
                  >
                    <FormField
                      control={form.control}
                      name={`lines.${idx}.ingredientId`}
                      render={({ field }) => (
                        <FormItem>
                          <FieldLabel className="text-xs" help="The item being sent.">
                            Ingredient
                          </FieldLabel>
                          <FormControl>
                            <CatalogItemCombobox
                              options={ingredientOptions}
                              value={field.value || null}
                              onSelect={(option) => field.onChange(option.id)}
                              placeholder="Select an ingredient…"
                              emptyHeading="No ingredients match"
                              emptyBody="Try a different search."
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`lines.${idx}.qty`}
                      render={({ field }) => (
                        <FormItem>
                          <FieldLabel
                            className="text-xs"
                            help="How much is being sent, in the item’s stock unit."
                          >
                            Qty
                          </FieldLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="10" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={fields.length === 1}
                      onClick={() => remove(idx)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </form>
          </Form>
        ) : receivingTransfer ? (
          <div className="grid max-h-[55vh] gap-3 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Transfer {receivingTransfer.transferId.slice(0, 8)} — confirm the quantity actually
              received per line. Variance is received minus shipped.
            </p>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2 font-medium">Ingredient</th>
                    <th className="p-2 font-medium">Shipped</th>
                    <th className="p-2 font-medium">Received</th>
                    <th className="p-2 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {receivingTransfer.lines.map((line) => {
                    const receivedRaw = receivedQtyByIngredient[line.ingredientId] ?? "";
                    const received = Number(receivedRaw) || 0;
                    const shipped = Number(line.qtyShipped);
                    const variance = received - shipped;
                    return (
                      <tr
                        key={line.ingredientId}
                        className={cn(
                          "border-b last:border-b-0",
                          varianceRowClassName(variance, received),
                        )}
                      >
                        <td className="p-2">{ingredientName(line.ingredientId)}</td>
                        <td className="p-2 text-muted-foreground">{line.qtyShipped}</td>
                        <td className="p-2">
                          <Input
                            inputMode="decimal"
                            aria-label={`Received quantity for ${ingredientName(line.ingredientId)}`}
                            value={receivedRaw}
                            onChange={(e) =>
                              setReceivedQtyByIngredient((prev) => ({
                                ...prev,
                                [line.ingredientId]: e.target.value,
                              }))
                            }
                            className="h-8 w-24"
                          />
                        </td>
                        <td className="p-2 tabular-nums">
                          {variance > 0 ? `+${variance}` : variance}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : pendingLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (pendingTransfers ?? []).length === 0 ? (
          <EmptyState
            title="No transfers awaiting receipt"
            description="Transfers shipped to this branch will show up here."
          />
        ) : (
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto">
            {(pendingTransfers ?? []).map((t) => (
              <div
                key={t.transferId}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <div>
                  <div className="font-medium">Transfer {t.transferId.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{t.lines.length} line(s)</div>
                </div>
                <Button type="button" size="sm" onClick={() => openReceive(t)}>
                  Receive
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (section === "receive" && receivingTransfer) {
                setReceivingTransfer(null);
              } else {
                handleOpenChange(false);
              }
            }}
          >
            {section === "receive" && receivingTransfer ? "Back" : "Cancel"}
          </Button>
          {section === "ship" ? (
            <Button type="submit" form="transfer-ship-form" disabled={shipTransfer.isPending}>
              {shipTransfer.isPending ? "Shipping…" : "Ship transfer"}
            </Button>
          ) : receivingTransfer ? (
            <Button type="button" onClick={submitReceive} disabled={receiveTransfer.isPending}>
              {receiveTransfer.isPending ? "Receiving…" : "Confirm receive"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

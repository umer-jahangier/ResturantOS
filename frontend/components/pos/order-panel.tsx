"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { RevisionBadge, RevisionCountChip, type RevisionLogEntry } from "@/components/pos/revision-chip";
import { SettlementActions } from "@/components/pos/settlement-actions";
import {
  useRemoveItem,
  useCancelItem,
  useMarkServed,
  useUpdateInstructions,
  useSendToKds,
} from "@/lib/hooks/pos/use-orders";
import { getOrderDisplayStatus, type Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderPanelProps {
  order: Order | null;
  /**
   * @deprecated OrderPanel now drives its own send-to-kitchen mutation internally
   * (needed for the revision-aware CTA label/enable-state + the "Rev {n} sent…" toast,
   * POS-12/POS-15 — a fire-and-forget callback prop can't give onSuccess/onError
   * semantics). Kept optional so the existing `PosTerminal` caller (out of this plan's
   * file scope — owned by plan 08) keeps compiling unchanged.
   */
  onSendToKitchen?: () => void;
  /** @deprecated see `onSendToKitchen` — OrderPanel tracks its own `isPending` now. */
  isSending?: boolean;
}

const SETTLED_STATUSES: ReadonlySet<Order["status"]> = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

/** Groups fired items by revisionNo into the shared revision-chip's log shape. */
function deriveRevisionLog(items: Order["items"]): RevisionLogEntry[] {
  const byRevision = new Map<number, { firedAt: string | null; itemCount: number }>();
  for (const item of items) {
    if (item.revisionNo <= 0) continue; // not yet fired
    const existing = byRevision.get(item.revisionNo);
    if (existing) {
      existing.itemCount += 1;
      if (!existing.firedAt && item.firedAt) existing.firedAt = item.firedAt;
    } else {
      byRevision.set(item.revisionNo, { firedAt: item.firedAt, itemCount: 1 });
    }
  }
  return Array.from(byRevision.entries())
    .sort(([a], [b]) => a - b)
    .map(([revisionNo, v]) => ({ revisionNo, ...v }));
}

export function OrderPanel({ order }: OrderPanelProps) {
  const sendToKds = useSendToKds(order?.id ?? "");
  const updateInstructions = useUpdateInstructions(order?.id ?? "");

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 gap-2">
        <span className="text-4xl">🧾</span>
        <p className="text-sm">No active order</p>
        <p className="text-xs">Select items from the menu to start</p>
      </div>
    );
  }

  const isSettled = SETTLED_STATUSES.has(order.status);
  const pendingItems = order.items.filter((i) => i.itemStatus === "PENDING");
  const hasFiredLines = order.items.some(
    (i) => i.itemStatus !== "PENDING" && i.itemStatus !== "CANCELLED",
  );
  const isRevisionFire = hasFiredLines && pendingItems.length > 0;
  const canSendToKitchen = !isSettled && pendingItems.length > 0;
  const ctaLabel = isRevisionFire ? `Send New Items (${pendingItems.length})` : "Send to Kitchen";
  const revisions = deriveRevisionLog(order.items);
  const displayStatus = getOrderDisplayStatus(order);

  const handleSendToKitchen = async () => {
    const firingCount = pendingItems.length;
    try {
      const updated = await sendToKds.mutateAsync();
      const newRevisionNo = Math.max(0, ...updated.items.map((i) => i.revisionNo));
      toast.success(`Rev ${newRevisionNo} sent to kitchen — ${firingCount} item(s)`);
    } catch {
      toast.error("Failed to send to kitchen. Please try again.");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Order header */}
      <div className="px-4 py-3 border-b space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm">{order.orderNo ?? "New Order"}</span>
          <StatusBadge status={displayStatus} />
        </div>
        {order.coverCount > 0 && (
          <p className="text-xs text-muted-foreground">{order.coverCount} cover(s)</p>
        )}
        {revisions.length > 0 && <RevisionCountChip revisions={revisions} />}
      </div>

      {/* Special instructions (order-level, POS-13) */}
      <SpecialInstructionsField
        notes={order.notes}
        disabled={isSettled}
        onSave={(notes) => updateInstructions.mutate({ notes })}
      />

      {/* Line items */}
      <div className="flex-1 overflow-y-auto divide-y">
        {order.items.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            Add items from the menu
          </div>
        ) : (
          order.items.map((item) => (
            <OrderLineItem key={item.id} item={item} orderId={order.id} isSettled={isSettled} />
          ))
        )}
      </div>

      {/* Totals */}
      <div className="border-t px-4 py-3 space-y-1 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <MoneyDisplay paisa={order.subtotalPaisa} className="font-mono" />
        </div>
        {order.discountPaisa > 0 && (
          <div className="flex justify-between text-success">
            <span>Discount</span>
            <span className="font-mono">
              -<MoneyDisplay paisa={order.discountPaisa} />
            </span>
          </div>
        )}
        {order.taxPaisa > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Tax</span>
            <MoneyDisplay paisa={order.taxPaisa} className="font-mono" />
          </div>
        )}
        <div className="flex justify-between font-semibold text-base pt-1 border-t">
          <span>Total</span>
          <MoneyDisplay paisa={order.totalPaisa} className="font-mono" />
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        <button
          onClick={() => void handleSendToKitchen()}
          disabled={!canSendToKitchen || sendToKds.isPending}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          {sendToKds.isPending ? "Sending..." : ctaLabel}
        </button>
        <SettlementActions order={order} />
      </div>
    </div>
  );
}

// ── Special instructions (order-level, POS-13) ─────────────────────────────────

interface SpecialInstructionsFieldProps {
  notes: string | null;
  disabled: boolean;
  onSave: (notes: string) => void;
}

function SpecialInstructionsField({ notes, disabled, onSave }: SpecialInstructionsFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");

  if (!editing) {
    if (!notes) {
      return (
        <div className="px-4 py-2 border-b">
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
            disabled={disabled}
            className="text-xs text-primary underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
          >
            + Add note
          </button>
        </div>
      );
    }

    return (
      <div className="px-4 py-2 border-b">
        <button
          type="button"
          onClick={() => {
            setDraft(notes);
            setEditing(true);
          }}
          disabled={disabled}
          className="flex w-full items-start gap-1.5 text-left text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MessageSquare className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="italic">{notes}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-2 border-b space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-semibold">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Special Instructions
      </label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={240}
        rows={2}
        placeholder="e.g. Birthday — bring cake last"
        aria-label="Special instructions"
        className="w-full rounded border bg-background px-2 py-1.5 text-xs resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{draft.length}/240</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs px-2 py-1 rounded border"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Line item row ────────────────────────────────────────────────────────────

interface OrderLineItemProps {
  item: Order["items"][number];
  orderId: string;
  isSettled: boolean;
}

function OrderLineItem({ item, orderId, isSettled }: OrderLineItemProps) {
  const removeItem = useRemoveItem(orderId);
  const cancelItem = useCancelItem(orderId);
  const markServed = useMarkServed(orderId);
  const updateInstructions = useUpdateInstructions(orderId);

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.notes ?? "");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const isActive = item.itemStatus !== "PENDING" && item.itemStatus !== "CANCELLED" && item.itemStatus !== "SERVED";
  const canRemove = !isSettled && item.itemStatus === "PENDING";
  const canCancel = !isSettled && isActive;
  const canMarkServed = !isSettled && isActive;
  const isCancelled = item.itemStatus === "CANCELLED";

  const saveNote = () => {
    updateInstructions.mutate({ itemNotes: { [item.id]: noteDraft } });
    setEditingNote(false);
  };

  return (
    <div className="px-4 py-2 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p
              className={cn(
                "text-sm font-medium truncate",
                isCancelled && "line-through text-muted-foreground",
              )}
            >
              {item.itemNameSnapshot}
            </p>
            <RevisionBadge revisionNo={item.revisionNo} />
          </div>
          {item.modifiers.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              +{item.modifiers.map((m) => m.modifierNameSnapshot).join(", ")}
            </p>
          )}
          {item.notes && !editingNote && (
            <p className="text-xs text-muted-foreground italic">Note: {item.notes}</p>
          )}
        </div>
        {/* Qty display (≥40px touch area) */}
        <div className="flex items-center gap-1">
          <span className="text-sm font-mono tabular-nums min-w-[24px] text-center">
            ×{item.quantity}
          </span>
        </div>
        <MoneyDisplay paisa={item.lineTotalPaisa} className="text-sm font-mono" />
        {canRemove && (
          <button
            onClick={() => removeItem.mutate(item.id)}
            disabled={removeItem.isPending}
            className="ml-1 text-muted-foreground hover:text-destructive min-w-[40px] min-h-[40px] flex items-center justify-center rounded"
            aria-label="Remove item"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={item.itemStatus} className="text-[10px]" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setNoteDraft(item.notes ?? "");
              setEditingNote((v) => !v);
            }}
            disabled={isSettled}
            aria-label={`Edit note for ${item.itemNameSnapshot}`}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
          </button>

          {canMarkServed && (
            <button
              type="button"
              onClick={() => markServed.mutate(item.id)}
              disabled={markServed.isPending}
              className="text-xs px-2 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-50"
            >
              Mark Served
            </button>
          )}

          {canCancel && !confirmingCancel && (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="text-xs px-2 py-1 rounded border border-destructive text-destructive hover:bg-destructive/10"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {confirmingCancel && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs space-y-1.5">
          <p className="font-medium text-destructive">Cancel Item</p>
          <p className="text-muted-foreground">
            Remove {item.itemNameSnapshot} from this order? If it was already sent to the
            kitchen, staff will see it marked cancelled.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              className="px-2 py-1 rounded border"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                cancelItem.mutate(item.id);
                setConfirmingCancel(false);
              }}
              disabled={cancelItem.isPending}
              className="px-2 py-1 rounded bg-destructive text-destructive-foreground"
            >
              Confirm Cancel
            </button>
          </div>
        </div>
      )}

      {editingNote && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            maxLength={140}
            placeholder="e.g. no onions"
            aria-label={`Note for ${item.itemNameSnapshot}`}
            className="flex-1 rounded border bg-background px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={saveNote}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

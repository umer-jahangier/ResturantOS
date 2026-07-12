"use client";

import { useState } from "react";
import { MessageSquare, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { RevisionBadge, RevisionCountChip, type RevisionLogEntry } from "@/components/pos/revision-chip";
import { SettlementActions } from "@/components/pos/settlement-actions";
import { OrderTypeToggle } from "@/components/pos/order-type-toggle";
import { TableSelectCombobox } from "@/components/pos/table-select-combobox";
import { cartLineKey, cartTotalPaisa, cartTaxPaisa, type CartLine } from "@/components/pos/cart-reducer";
import {
  useRemoveItem,
  useCancelItem,
  useMarkServed,
  useUpdateInstructions,
  useSendToKds,
} from "@/lib/hooks/pos/use-orders";
import { getOrderDisplayStatus, type Order, type OrderType } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderPanelProps {
  /** Client-only cart (POS-16/D-01) — rendered until the order has been persisted. */
  cart: CartLine[];
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  tableId: string | null;
  onTableChange: (tableId: string | null) => void;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  /**
   * Non-null once the cart has been persisted (first Send/Charge succeeded, POS-19/
   * D-04). Switches this panel from cart-rendering to server-order-rendering — the
   * order's own revision-aware Send-to-Kitchen/charge/void logic below is unchanged
   * from before this plan and only ever runs once `sentOrder` is non-null (its `id` is
   * then a stable, already-known value — no stale-closure risk).
   */
  sentOrder: Order | null;
  /** True while the FIRST persist (createOrder + addItem*) is in flight. */
  isPersisting: boolean;
  /** Persists the cart (createOrder + addItem* + first send-to-kds) — pre-send only. */
  onSendToKitchen: () => void | Promise<void>;
  /** Persists the cart as a DRAFT (createOrder + addItem*, no fire) — pre-send only. */
  onSaveAsDraft: () => void | Promise<void>;
  /** Persists + fires the cart, then navigates to the full-page charge — pre-send only. */
  onChargeNow: () => void | Promise<void>;
  /** Clear / New Order (D-04) — resets the terminal to an empty cart. */
  onClearNewOrder: () => void;
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

export function OrderPanel({
  cart,
  orderType,
  onOrderTypeChange,
  tableId,
  onTableChange,
  onIncrement,
  onDecrement,
  sentOrder,
  isPersisting,
  onSendToKitchen,
  onSaveAsDraft,
  onChargeNow,
  onClearNewOrder,
}: OrderPanelProps) {
  if (!sentOrder) {
    return (
      <PreSendCart
        cart={cart}
        orderType={orderType}
        onOrderTypeChange={onOrderTypeChange}
        tableId={tableId}
        onTableChange={onTableChange}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
        isPersisting={isPersisting}
        onSendToKitchen={onSendToKitchen}
        onSaveAsDraft={onSaveAsDraft}
        onChargeNow={onChargeNow}
      />
    );
  }

  return <SentOrder order={sentOrder} onClearNewOrder={onClearNewOrder} />;
}

// ── Pre-send: client-only cart (POS-16/D-01, POS-17/D-02, POS-18/D-03) ─────────────

interface PreSendCartProps {
  cart: CartLine[];
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  tableId: string | null;
  onTableChange: (tableId: string | null) => void;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  isPersisting: boolean;
  onSendToKitchen: () => void | Promise<void>;
  onSaveAsDraft: () => void | Promise<void>;
  onChargeNow: () => void | Promise<void>;
}

function PreSendCart({
  cart,
  orderType,
  onOrderTypeChange,
  tableId,
  onTableChange,
  onIncrement,
  onDecrement,
  isPersisting,
  onSendToKitchen,
  onSaveAsDraft,
  onChargeNow,
}: PreSendCartProps) {
  const canSend = cart.length > 0 && !isPersisting;
  const subtotal = cartTotalPaisa(cart);
  const estTax = cartTaxPaisa(cart);
  const estTotal = subtotal + estTax;

  return (
    <div className="flex flex-col h-full">
      {/* Order type + table (D-03) */}
      <div className="px-4 py-3 border-b space-y-2">
        <OrderTypeToggle value={orderType} onChange={onOrderTypeChange} />
        {orderType === "DINE_IN" && (
          <TableSelectCombobox value={tableId} onChange={onTableChange} disabled={isPersisting} />
        )}
      </div>

      {/* Cart lines */}
      <div className="flex-1 overflow-y-auto divide-y">
        {cart.length === 0 ? (
          <EmptyState
            title="Add items to start an order"
            description="Tap a menu item to build the cart — nothing is saved until Send to Kitchen or Charge."
            className="h-full"
          />
        ) : (
          cart.map((line) => {
            const key = cartLineKey(line.menuItemId, line.modifierIds, line.notes);
            return <CartLineRow key={key} line={line} lineKey={key} onIncrement={onIncrement} onDecrement={onDecrement} />;
          })
        )}
      </div>

      {/* Totals — estimated tax shown up-front (KFC/Square-style), before any commit */}
      {cart.length > 0 && (
        <div className="border-t px-4 py-3 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <MoneyDisplay paisa={subtotal} className="font-mono" />
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax (est.)</span>
            <MoneyDisplay paisa={estTax} className="font-mono" />
          </div>
          <div className="flex justify-between font-semibold text-base pt-1 border-t">
            <span>Total (est.)</span>
            <MoneyDisplay paisa={estTotal} className="font-mono" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Estimated — final tax &amp; any discounts confirmed on the order.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        <button
          type="button"
          data-testid="send-to-kitchen-button"
          onClick={() => void onSendToKitchen()}
          disabled={!canSend}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          {isPersisting ? "Sending..." : "Send to Kitchen"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="save-draft-button"
            onClick={() => void onSaveAsDraft()}
            disabled={!canSend}
            className="flex-1 h-12 rounded-xl border font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent active:scale-[0.98] transition-all"
          >
            {isPersisting ? "Saving..." : "Save as Draft"}
          </button>
          <button
            type="button"
            data-testid="charge-now-button"
            onClick={() => void onChargeNow()}
            disabled={!canSend}
            aria-label="Charge Now"
            className="flex-1 h-12 rounded-xl bg-success text-success-foreground font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-success/90 active:scale-[0.98] transition-all"
          >
            {isPersisting ? "…" : "Charge Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CartLineRowProps {
  line: CartLine;
  lineKey: string;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
}

function CartLineRow({ line, lineKey, onIncrement, onDecrement }: CartLineRowProps) {
  return (
    <div className="px-4 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{line.name}</p>
        {line.notes && <p className="text-xs text-muted-foreground italic">Note: {line.notes}</p>}
      </div>

      {/* − / + steppers (POS-17) */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onDecrement(lineKey)}
          aria-label={`Decrease ${line.name} quantity`}
          className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </button>
        <span className="text-sm font-mono tabular-nums min-w-[24px] text-center">{line.quantity}</span>
        <button
          type="button"
          onClick={() => onIncrement(lineKey)}
          aria-label={`Increase ${line.name} quantity`}
          className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <MoneyDisplay paisa={line.unitPricePaisa * line.quantity} className="text-sm font-mono w-20 text-right" />
    </div>
  );
}

// ── Post-send: real server order (unchanged send/revision/settlement logic) ────────

interface SentOrderProps {
  order: Order;
  onClearNewOrder: () => void;
}

function SentOrder({ order, onClearNewOrder }: SentOrderProps) {
  const sendToKds = useSendToKds(order.id);
  const updateInstructions = useUpdateInstructions(order.id);

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
            <OrderLineItem key={item.id} item={item} orderId={order.id} orderStatus={order.status} isSettled={isSettled} />
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
        {canSendToKitchen && (
          <button
            type="button"
            data-testid="send-to-kitchen-button"
            onClick={() => void handleSendToKitchen()}
            disabled={sendToKds.isPending}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            {sendToKds.isPending ? "Sending..." : ctaLabel}
          </button>
        )}
        <SettlementActions order={order} />
        {/* Clear / New Order (POS-19/D-04) — resets the terminal to a fresh cart. The
            fired order stays fully intact and editable via Order Management. */}
        <button
          type="button"
          data-testid="clear-new-order-button"
          onClick={onClearNewOrder}
          className="w-full py-2.5 rounded-xl border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Clear / New Order
        </button>
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

// ── Line item row (post-send, unchanged) ────────────────────────────────────────

interface OrderLineItemProps {
  item: Order["items"][number];
  orderId: string;
  orderStatus: Order["status"];
  isSettled: boolean;
}

function OrderLineItem({ item, orderId, orderStatus, isSettled }: OrderLineItemProps) {
  const removeItem = useRemoveItem(orderId);
  const cancelItem = useCancelItem(orderId);
  const markServed = useMarkServed(orderId);
  const updateInstructions = useUpdateInstructions(orderId);

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.notes ?? "");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const isActive = item.itemStatus !== "PENDING" && item.itemStatus !== "CANCELLED" && item.itemStatus !== "SERVED";
  const isCancelled = item.itemStatus === "CANCELLED";
  // Not-yet-fired line on an OPEN order → Remove; on a fired order remove is server-blocked, so
  // it becomes cancellable instead (fixes the "PENDING-on-fired line is stuck" dead-end).
  const canRemove = !isSettled && item.itemStatus === "PENDING" && orderStatus === "OPEN";
  const canCancel = !isSettled && !isCancelled && item.itemStatus !== "SERVED" && !canRemove;
  const canMarkServed = !isSettled && isActive;

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

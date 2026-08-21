"use client";

import { useState } from "react";
import { CloudOff, MessageSquare, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
// The SHARED formatter, and the only way money is ever rendered — the caption below prints a
// delta inline inside a sentence, where a <MoneyDisplay> element cannot go.
import { formatPaisa } from "@/lib/adapters/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  RevisionBadge,
  RevisionCountChip,
  type RevisionLogEntry,
} from "@/components/pos/revision-chip";
import { SettlementActions } from "@/components/pos/settlement-actions";
import { OrderTypeToggle } from "@/components/pos/order-type-toggle";
import { TableSelectCombobox } from "@/components/pos/table-select-combobox";
import {
  cartLineKey,
  cartTotalPaisa,
  cartTaxPaisa,
  cartServiceChargePaisa,
  serviceChargeAppliesTo,
  lineSubtotalPaisa,
  modifierIdsOf,
  type CartLine,
} from "@/components/pos/cart-reducer";
import {
  useRemoveItem,
  useCancelItem,
  useMarkServed,
  useUpdateInstructions,
  useSendToKds,
} from "@/lib/hooks/pos/use-orders";
import { useQueuedOps } from "@/lib/hooks/pos/use-queued-ops";
import { useServiceChargePolicy } from "@/lib/hooks/pos/use-service-charge";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatServiceChargeRate } from "@/lib/models/service-charge.model";
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
  /** Removes a cart line outright (× button) — faster than decrementing to 0. */
  onRemove: (key: string) => void;
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
  onRemove,
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
        onRemove={onRemove}
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
  onRemove: (key: string) => void;
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
  onRemove,
  isPersisting,
  onSendToKitchen,
  onSaveAsDraft,
  onChargeNow,
}: PreSendCartProps) {
  const canSend = cart.length > 0 && !isPersisting;
  const subtotal = cartTotalPaisa(cart);
  const estTax = cartTaxPaisa(cart);

  /*
    D-3 — the service charge the check WILL carry, before it is created.

    Measured on table AUD3547: this panel read Subtotal Rs 2,259.00, Tax Rs 257.60,
    Total Rs 2,516.60, and the check created one tap later was Rs 2,629.55 —
    serviceChargePaisa 11295 at 5%. The charge is applied server-side at fire time and this
    panel did not know it existed, so every dine-in guest in the building was quoted 5% low
    while the charge page a minute later showed the figure correctly.

    Read over the branch's existing policy endpoint, which is gated on `pos.menu.view` — a
    permission any cashier who can load the menu already holds, so this costs no new grant.
  */
  const { branchId } = useCurrentUser();
  const { data: serviceChargePolicy } = useServiceChargePolicy(branchId);
  const chargeApplies = serviceChargeAppliesTo(serviceChargePolicy ?? null, orderType);
  const estServiceCharge = chargeApplies
    ? cartServiceChargePaisa(subtotal, serviceChargePolicy!.ratePct)
    : 0;

  const estTotal = subtotal + estTax + estServiceCharge;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="order-panel">
      {/* Order type + table (D-03) */}
      <div className="shrink-0 px-4 py-3 border-b space-y-2">
        <OrderTypeToggle value={orderType} onChange={onOrderTypeChange} />
        {orderType === "DINE_IN" && (
          <TableSelectCombobox value={tableId} onChange={onTableChange} disabled={isPersisting} />
        )}
      </div>

      {/* Cart lines — the only scrollable region; totals/actions below stay fixed */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y">
        {cart.length === 0 ? (
          <EmptyState
            title="Add items to start an order"
            description="Tap a menu item to build the cart — nothing is saved until Send to Kitchen or Charge."
            className="h-full"
          />
        ) : (
          cart.map((line) => {
            const key = cartLineKey(line.menuItemId, modifierIdsOf(line), line.notes);
            return (
              <CartLineRow
                key={key}
                line={line}
                lineKey={key}
                onIncrement={onIncrement}
                onDecrement={onDecrement}
                onRemove={onRemove}
              />
            );
          })
        )}
      </div>

      {/* Totals — estimated tax shown up-front (KFC/Square-style), before any commit */}
      {cart.length > 0 && (
        <div className="shrink-0 border-t px-4 py-3 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <MoneyDisplay paisa={subtotal} className="font-mono" />
          </div>
          {/*
            F16 — "(est.)" is gone, and it had to earn that.

            The hedge was never really about arithmetic. The cart priced tax from the menu item's
            own `taxRatePct` column, which most items do not carry, so the number was a guess:
            the walkthrough's Rs 1,657.00 check showed Rs 25.60 of tax — 1.5% — because two of
            its lines had a per-item rate and the rest had none.

            It now prices from `effectiveTaxRatePct`, the rate the server resolved and the rate
            the server will charge, through integer arithmetic that is HALF_UP by construction
            (see cartTaxPaisa). There are no discounts before Send, so this figure is the order's
            figure. Saying "estimated" over a number that is exact teaches a cashier to distrust
            the screen, and a cashier who distrusts the screen stops reading it.
          */}
          <div className="flex justify-between text-muted-foreground">
            <span>Tax</span>
            <span data-testid="cart-tax">
              <MoneyDisplay paisa={estTax} className="font-mono" />
            </span>
          </div>
          {/*
            Shown ONLY when the branch actually charges it on this channel, and captioned with the
            branch's own wording and rate (D-3). A row that always appeared, at Rs 0.00, is the
            defect F20 removed from the printed bill — it teaches a cashier to stop reading the
            line. Switching the order type to takeaway makes it disappear here for the same reason
            it disappears from the check: the policy is per channel.
          */}
          {estServiceCharge > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span data-testid="cart-service-charge-label">
                {serviceChargePolicy!.label || "Service charge"} (
                {formatServiceChargeRate(serviceChargePolicy!.ratePct)})
              </span>
              <span data-testid="cart-service-charge">
                <MoneyDisplay paisa={estServiceCharge} className="font-mono" />
              </span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base pt-1 border-t">
            <span>Total</span>
            <span data-testid="cart-total">
              <MoneyDisplay paisa={estTotal} className="font-mono" />
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Any discount is applied to the order after it is sent.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="shrink-0 px-4 pb-4 pt-2 space-y-2">
        <button
          type="button"
          data-testid="send-to-kitchen-button"
          onClick={() => void onSendToKitchen()}
          disabled={!canSend}
          className="w-full py-3 rounded-xl bg-primary-solid text-primary-solid-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-solid/90 active:scale-[0.98] transition-all"
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
  onRemove: (key: string) => void;
}

function CartLineRow({ line, lineKey, onIncrement, onDecrement, onRemove }: CartLineRowProps) {
  return (
    <div className="px-4 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{line.name}</p>
        {/* S6 — the chosen modifiers, by NAME, under the dish. Without this the cashier can see
            that a line costs more than the menu price and has no way to find out why, and cannot
            tell two otherwise-identical lines apart before sending them to the kitchen. */}
        {line.modifiers.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="cart-line-modifiers">
            {line.modifiers
              .map((m) =>
                m.priceDeltaPaisa === 0
                  ? m.name
                  : `${m.name} ${m.priceDeltaPaisa > 0 ? "+" : "−"}${formatPaisa(Math.abs(m.priceDeltaPaisa))}`,
              )
              .join(" · ")}
          </p>
        )}
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
        <span className="text-sm font-mono tabular-nums min-w-[24px] text-center">
          {line.quantity}
        </span>
        <button
          type="button"
          onClick={() => onIncrement(lineKey)}
          aria-label={`Increase ${line.name} quantity`}
          className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* S6: the line total INCLUDES the modifier deltas — one definition, shared with the cart
          subtotal and with the server's own `OrderPricingCalculator.lineSubtotal`. It read
          `unitPricePaisa * quantity` here, which would have shown the plain dish price beside a
          cart total that already carried the extras. */}
      <MoneyDisplay
        paisa={lineSubtotalPaisa(line)}
        className="text-sm font-mono w-20 text-right"
      />

      {/* Remove line outright — faster than decrementing quantity down to 0 */}
      <button
        type="button"
        onClick={() => onRemove(lineKey)}
        aria-label={`Remove ${line.name} from cart`}
        className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
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
  // What this order still owes the server (S0-07). Read from the outbox, not guessed
  // from the optimistic stub — see useQueuedOps.
  const queued = useQueuedOps(order.id);

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
      if (!updated) {
        // Queued, not fired. Saying "sent to kitchen" here is precisely the lie that
        // made a cashier stop watching an order the kitchen never received (S0-07).
        toast.info(
          `Queued — ${firingCount} item(s) reach the kitchen as soon as the connection returns.`,
        );
        return;
      }
      const newRevisionNo = Math.max(0, ...updated.items.map((i) => i.revisionNo));
      toast.success(`Rev ${newRevisionNo} sent to kitchen — ${firingCount} item(s)`);
    } catch {
      toast.error("Failed to send to kitchen. Please try again.");
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="order-panel">
      {/* Order header */}
      <div className="shrink-0 px-4 py-3 border-b space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm">
            {order.orderNo ?? (queued.queued > 0 ? "Queued order" : "New Order")}
          </span>
          <StatusBadge
            status={displayStatus}
            {...(queued.fireQueued
              ? {
                  label: "Queued to fire",
                  className: "bg-warning/15 text-warning border-warning/30",
                }
              : {})}
          />
        </div>
        {order.coverCount > 0 && (
          <p className="text-xs text-muted-foreground">{order.coverCount} cover(s)</p>
        )}
        {revisions.length > 0 && <RevisionCountChip revisions={revisions} />}
      </div>

      {queued.queued > 0 && <QueuedStrip queued={queued} />}

      {/* Special instructions (order-level, POS-13) */}
      <SpecialInstructionsField
        notes={order.notes}
        disabled={isSettled}
        onSave={(notes) => updateInstructions.mutate({ notes })}
      />

      {/* Line items — the only scrollable region; totals/actions below stay fixed */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y">
        {order.items.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            Add items from the menu
          </div>
        ) : (
          order.items.map((item) => (
            <OrderLineItem
              key={item.id}
              item={item}
              orderId={order.id}
              orderStatus={order.status}
              isSettled={isSettled}
            />
          ))
        )}
      </div>

      {/* Totals */}
      <div className="shrink-0 border-t px-4 py-3 space-y-1 text-sm">
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
      <div className="shrink-0 px-4 pb-4 pt-2 space-y-2">
        {canSendToKitchen && (
          <button
            type="button"
            data-testid="send-to-kitchen-button"
            onClick={() => void handleSendToKitchen()}
            disabled={sendToKds.isPending}
            className="w-full py-3 rounded-xl bg-primary-solid text-primary-solid-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-solid/90 active:scale-[0.98] transition-all"
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

/**
 * The one sentence that stops a cashier walking away from an order the kitchen has not
 * received (S0-07). It is a `role="status"` that STAYS on screen for as long as the
 * outbox owes this order anything — a toast is gone in four seconds, and the toast was
 * exactly what a cashier missed while looking at the queue.
 *
 * DESIGN-BRIEF §27: says what happened and what happens next, never a technical error.
 */
function QueuedStrip({ queued }: { queued: ReturnType<typeof useQueuedOps> }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="order-queued-strip"
      className="shrink-0 flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-small text-foreground"
    >
      <CloudOff className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-semibold">
          {queued.fireQueued
            ? "Queued — the kitchen has not seen this yet."
            : "Queued — not saved to the server yet."}
        </span>{" "}
        {queued.queued} change{queued.queued === 1 ? "" : "s"} will send the moment the
        connection returns. Keep this order open, or find it in Order Management afterwards.
      </p>
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
            className="text-xs px-2 py-1 rounded bg-primary-solid text-primary-solid-foreground"
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

  const isActive =
    item.itemStatus !== "PENDING" &&
    item.itemStatus !== "CANCELLED" &&
    item.itemStatus !== "SERVED";
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
            Remove {item.itemNameSnapshot} from this order? If it was already sent to the kitchen,
            staff will see it marked cancelled.
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
            className="text-xs px-2 py-1 rounded bg-primary-solid text-primary-solid-foreground"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

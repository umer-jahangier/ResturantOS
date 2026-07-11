"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import { SettlementActions } from "@/components/pos/settlement-actions";
import { useRemoveItem } from "@/lib/hooks/pos/use-orders";
import type { Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderPanelProps {
  order: Order | null;
  onSendToKitchen: () => void;
  isSending: boolean;
}

export function OrderPanel({ order, onSendToKitchen, isSending }: OrderPanelProps) {
  const canSendToKitchen = order?.status === "OPEN" && (order?.items?.length ?? 0) > 0;

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 gap-2">
        <span className="text-4xl">🧾</span>
        <p className="text-sm">No active order</p>
        <p className="text-xs">Select items from the menu to start</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Order header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">
            {order.orderNo ?? "New Order"}
          </span>
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              order.status === "OPEN"
                ? "bg-blue-100 text-blue-700"
                : order.status === "SENT_TO_KDS"
                ? "bg-orange-100 text-orange-700"
                : "bg-muted text-muted-foreground"
            )}
          >
            {order.status}
          </span>
        </div>
        {order.coverCount > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">{order.coverCount} cover(s)</p>
        )}
      </div>

      {/* Line items */}
      <div className="flex-1 overflow-y-auto divide-y">
        {order.items.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            Add items from the menu
          </div>
        ) : (
          order.items.map((item) => (
            <OrderLineItem key={item.id} item={item} orderId={order.id} orderStatus={order.status} />
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
          <div className="flex justify-between text-green-600">
            <span>Discount</span>
            <span className="font-mono">-<MoneyDisplay paisa={order.discountPaisa} /></span>
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
          onClick={onSendToKitchen}
          disabled={!canSendToKitchen || isSending}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          {isSending ? "Sending..." : "Send to Kitchen"}
        </button>
        <SettlementActions order={order} />
      </div>
    </div>
  );
}

interface OrderLineItemProps {
  item: Order["items"][number];
  orderId: string;
  orderStatus: Order["status"];
}

function OrderLineItem({ item, orderId, orderStatus }: OrderLineItemProps) {
  const removeItem = useRemoveItem(orderId);
  const canModify = orderStatus === "OPEN";

  return (
    <div className="px-4 py-2 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.itemNameSnapshot}</p>
        {item.modifiers.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            +{item.modifiers.map((m) => m.modifierNameSnapshot).join(", ")}
          </p>
        )}
        {item.notes && (
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
      {canModify && (
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
  );
}

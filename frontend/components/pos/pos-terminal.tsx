"use client";

import { useCallback, useRef, useState } from "react";
import { MenuGrid } from "@/components/pos/menu-grid";
import { OrderPanel } from "@/components/pos/order-panel";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useCreateOrder, useAddItem, useOrder } from "@/lib/hooks/pos/use-orders";
import { useFireToKitchen } from "@/lib/hooks/pos/use-fire-to-kitchen";
import { addLine, clearCart, decrementLine, incrementLine, type CartLine } from "@/components/pos/cart-reducer";
import type { MenuItem, OrderType } from "@/lib/models/pos.model";

interface PosTerminalProps {
  /**
   * The page-level selected table (TableFloorView -> page.tsx state) — pre-fills the
   * terminal's own table selector when an AVAILABLE table was tapped. `page.tsx`
   * remounts `PosTerminal` on table change (`key={selectedTableId}`); this is only
   * ever read at mount time as the initial value — the terminal's own
   * `table-select-combobox` (D-03) owns the LIVE selection from then on.
   */
  tableId?: string | null;
}

/**
 * The order-taking terminal (POS-16..19/D-01..D-04): a client-only cart in local
 * React state. NOTHING persists to pos-service until the cashier explicitly hits
 * Send to Kitchen or Charge — no DRAFT order is ever created on a menu tap.
 */
export function PosTerminal({ tableId }: PosTerminalProps) {
  const { branchId } = useCurrentUser();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(tableId ?? null);

  // Non-null once the cart has been persisted (first Send/Charge succeeded). Gates
  // Charge Now and switches OrderPanel from cart-rendering to server-order-rendering.
  const [orderId, setOrderId] = useState<string | null>(null);
  // ONE clientOrderId per cart lifetime — preserves idempotency across retries of the
  // SAME persist attempt (RESEARCH POS-16, HIGH risk). Regenerated only on Clear/New
  // Order, never on every render.
  const clientOrderIdRef = useRef<string>(crypto.randomUUID());
  // Guards against a rapid double-click on Send to Kitchen firing TWO concurrent
  // persist attempts before React state (`orderId`) commits on the next render — the
  // same class of stale-read race already fixed once for menu-item taps
  // (pos-terminal.tsx history, `creatingOrderRef`). A plain ref is read/written
  // synchronously within the same event-handler invocation, unlike component state.
  const sendInFlightRef = useRef(false);

  const createOrder = useCreateOrder();
  const addItem = useAddItem();
  const fireToKitchen = useFireToKitchen();
  const { data: sentOrder } = useOrder(orderId ?? "");

  const isPersisting = createOrder.isPending || addItem.isPending || fireToKitchen.isPending;

  /**
   * Menu tap — ALWAYS cart-only, NEVER a network call (POS-16/D-01), regardless of
   * whether the current order has already been sent. Adding MORE items to an
   * already-fired order (a new PENDING revision line) is Order Management's "Send New
   * Items" flow (POS-21/D-06, a separate plan's wiring) — the terminal itself only
   * ever offers Clear/New Order once sent (POS-19/D-04), never a second silent
   * persist path from a menu tap.
   */
  const handleItemSelect = useCallback((item: MenuItem) => {
    setCart((prev) =>
      addLine(prev, { menuItemId: item.id, name: item.name, unitPricePaisa: item.basePricePaisa }),
    );
  }, []);

  const handleIncrement = useCallback((key: string) => {
    setCart((prev) => incrementLine(prev, key));
  }, []);

  const handleDecrement = useCallback((key: string) => {
    setCart((prev) => decrementLine(prev, key));
  }, []);

  const handleClearNewOrder = useCallback(() => {
    setCart(clearCart());
    setOrderType("DINE_IN");
    setSelectedTableId(tableId ?? null);
    setOrderId(null);
    clientOrderIdRef.current = crypto.randomUUID();
  }, [tableId]);

  /**
   * Lazy persist (POS-16/D-01): only called from the pre-send cart view. Creates the
   * order ONCE (single clientOrderId, reused across any retry of this same attempt),
   * adds every cart line (existing `useCreateOrder`/`useAddItem` hooks reused AS-IS —
   * preserves ORDER_CREATED, table-occupancy sync, offline-outbox behaviour), then
   * fires it to the kitchen in the same click. Sequential (not `Promise.all`) so
   * every line lands on the just-created order before firing.
   */
  const handleSendToKitchen = useCallback(async () => {
    if (cart.length === 0 || orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    try {
      const newOrder = await createOrder.mutateAsync({
        branchId,
        clientOrderId: clientOrderIdRef.current,
        type: orderType,
        coverCount: 1,
        ...(selectedTableId ? { tableId: selectedTableId } : {}),
      });

      for (const line of cart) {
        // Sequential adds by design — each must land before the next so the fired
        // revision includes every line.
        await addItem.mutateAsync({
          orderId: newOrder.id,
          payload: {
            menuItemId: line.menuItemId,
            branchId,
            quantity: line.quantity,
            ...(line.modifierIds.length > 0 ? { modifierIds: line.modifierIds } : {}),
            ...(line.notes ? { notes: line.notes } : {}),
          },
        });
      }

      setOrderId(newOrder.id);
      setCart(clearCart());

      await fireToKitchen.mutateAsync({ orderId: newOrder.id });
    } finally {
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, createOrder, addItem, fireToKitchen, branchId, orderType, selectedTableId]);

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Left: Menu grid — 2/3 width */}
      <div className="flex-1 overflow-hidden border-r">
        <MenuGrid onItemSelect={handleItemSelect} />
      </div>

      {/* Right: Order panel — fixed width */}
      <div className="w-80 flex-shrink-0 overflow-hidden flex flex-col">
        <OrderPanel
          cart={cart}
          orderType={orderType}
          onOrderTypeChange={setOrderType}
          tableId={selectedTableId}
          onTableChange={setSelectedTableId}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          sentOrder={sentOrder ?? null}
          isPersisting={isPersisting}
          onSendToKitchen={handleSendToKitchen}
          onClearNewOrder={handleClearNewOrder}
        />
      </div>
    </div>
  );
}

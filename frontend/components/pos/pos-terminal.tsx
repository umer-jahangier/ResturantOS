"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  const router = useRouter();

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
      addLine(prev, {
        menuItemId: item.id,
        name: item.name,
        unitPricePaisa: item.basePricePaisa,
        taxRatePct: item.taxRatePct,
      }),
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
   * Lazy persist (POS-16/D-01): creates the order ONCE (single clientOrderId, reused
   * across any retry of this same attempt), then adds every cart line sequentially so
   * each lands before the next. Shared by Send to Kitchen / Save as Draft / Charge Now —
   * the only difference between those is what happens AFTER the cart is persisted (fire,
   * park, or navigate to charge). Reuses the existing hooks AS-IS (ORDER_CREATED,
   * table-occupancy sync, offline-outbox behaviour preserved). Returns the new order.
   */
  const persistCart = useCallback(async () => {
    const newOrder = await createOrder.mutateAsync({
      branchId,
      clientOrderId: clientOrderIdRef.current,
      type: orderType,
      coverCount: 1,
      ...(selectedTableId ? { tableId: selectedTableId } : {}),
    });

    for (const line of cart) {
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
    return newOrder;
  }, [cart, createOrder, addItem, branchId, orderType, selectedTableId]);

  const handleSendToKitchen = useCallback(async () => {
    if (cart.length === 0 || orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    try {
      const newOrder = await persistCart();
      setOrderId(newOrder.id);
      setCart(clearCart());
      await fireToKitchen.mutateAsync({ orderId: newOrder.id });
    } finally {
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, fireToKitchen]);

  /**
   * Charge Now (pre-send): persists the cart WITHOUT firing to the kitchen, then navigates to
   * the full-page charge surface. Payment happens FIRST; the kitchen is fired only AFTER the
   * order is fully paid (ChargeSummary handles that, gated on `sentToKdsAt == null`). This keeps
   * the two flows fully isolated: an order that was already sent to the kitchen and is charged
   * at the end is NOT re-fired (its sentToKdsAt is set). The terminal unmounts on navigation.
   */
  const handleChargeNow = useCallback(async () => {
    if (cart.length === 0 || orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    try {
      const newOrder = await persistCart();
      router.push(`/app/pos/orders/${newOrder.id}/charge`);
    } catch {
      toast.error("Couldn't start charge. Please try again.");
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, router]);

  /**
   * Save as Draft (explicit park): persists the cart WITHOUT firing to the kitchen — it
   * lands with every line PENDING (derivedStatus DRAFT), so it shows under Order
   * Management's "Draft" filter, resumable or cancelable there. Resets the terminal to a
   * clean cart for the next customer.
   */
  const handleSaveAsDraft = useCallback(async () => {
    if (cart.length === 0 || orderId || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    try {
      const newOrder = await persistCart();
      setCart(clearCart());
      setOrderType("DINE_IN");
      setSelectedTableId(tableId ?? null);
      setOrderId(null);
      clientOrderIdRef.current = crypto.randomUUID();
      toast.success(`Saved as draft${newOrder.orderNo ? ` — ${newOrder.orderNo}` : ""}. Find it in Order Management.`);
    } catch {
      toast.error("Failed to save draft. Please try again.");
    } finally {
      sendInFlightRef.current = false;
    }
  }, [cart, orderId, persistCart, tableId]);

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
          onSaveAsDraft={handleSaveAsDraft}
          onChargeNow={handleChargeNow}
          onClearNewOrder={handleClearNewOrder}
        />
      </div>
    </div>
  );
}

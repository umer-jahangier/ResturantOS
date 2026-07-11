"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { MenuGrid } from "@/components/pos/menu-grid";
import { OrderPanel } from "@/components/pos/order-panel";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useCreateOrder, useAddItem, useSendToKds, useOrder } from "@/lib/hooks/pos/use-orders";
import type { MenuItem } from "@/lib/models/pos.model";

interface PosTerminalProps {
  /**
   * The page-level selected table (plan 06's TableFloorView -> page.tsx state), bound
   * into `createOrder` so a new order links to the tapped AVAILABLE table (POS-15).
   * `page.tsx` remounts `PosTerminal` on table change (`key={selectedTableId}`), so this
   * is only ever read at order-creation time for the CURRENT mount, never stale.
   */
  tableId?: string | null;
}

export function PosTerminal({ tableId }: PosTerminalProps) {
  const { branchId } = useCurrentUser();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  // Investigation (POS-15 "can't select items after N" — GitNexus MCP unavailable this
  // session; traced via Grep/Read across pos-terminal/use-orders/order-panel/
  // pos.repository/OrderServiceImpl/OrderMapper, no hardcoded array-length/.slice(0,N)/
  // pagination cap found anywhere in the add-item path). Root cause: `activeOrderId`
  // React state is only visible to a NEW render — but `handleItemSelect` can be
  // re-invoked (fast cashier taps) before the state update from a PRIOR invocation has
  // committed. The already-fixed "first item" bug is one instance of this general class
  // (the addItem mutation hook bound to a stale, still-null orderId); the *general* bug
  // is that ANY rapid tap landing inside the same async window as an in-flight
  // createOrder call also reads `activeOrderId` as null and fires its OWN createOrder,
  // silently splitting items across multiple orphaned orders (only the order that wins
  // the setActiveOrderId race stays visible — the rest look "dropped"). Fix: track the
  // order id in a ref (updated synchronously, not just on next render) and dedupe
  // concurrent order-creation onto a single in-flight promise every tap awaits; and
  // (companion fix, use-orders.ts) `useAddItem` no longer binds `orderId` at hook-creation
  // time — it now takes `orderId` as a per-call mutate variable, so the mutation itself
  // can never be stale-bound either.
  const orderIdRef = useRef<string | null>(null);
  useEffect(() => {
    orderIdRef.current = activeOrderId;
  }, [activeOrderId]);
  const creatingOrderRef = useRef<Promise<string> | null>(null);

  const createOrder = useCreateOrder();
  const addItem = useAddItem();
  const { data: activeOrder } = useOrder(activeOrderId ?? "");
  const sendToKds = useSendToKds(activeOrderId ?? "");

  const ensureOrderId = useCallback(async (): Promise<string> => {
    if (orderIdRef.current) return orderIdRef.current;

    if (!creatingOrderRef.current) {
      creatingOrderRef.current = (async () => {
        const clientOrderId = crypto.randomUUID();
        const newOrder = await createOrder.mutateAsync({
          branchId,
          clientOrderId,
          type: "DINE_IN",
          coverCount: 1,
          ...(tableId ? { tableId } : {}),
        });
        // Set synchronously (before the wrapping promise resolves) so any tap that was
        // waiting on this SAME in-flight creation — or any brand-new tap that arrives
        // right after — sees the real order id immediately, not on the next React commit.
        orderIdRef.current = newOrder.id;
        setActiveOrderId(newOrder.id);
        return newOrder.id;
      })();
      creatingOrderRef.current.finally(() => {
        creatingOrderRef.current = null;
      });
    }

    return creatingOrderRef.current;
  }, [branchId, createOrder, tableId]);

  const handleItemSelect = useCallback(
    async (item: MenuItem) => {
      const orderId = await ensureOrderId();
      await addItem.mutateAsync({
        orderId,
        payload: { menuItemId: item.id, branchId, quantity: 1 },
      });
    },
    [ensureOrderId, addItem, branchId]
  );

  const handleSendToKitchen = useCallback(async () => {
    if (!activeOrderId) return;
    await sendToKds.mutateAsync();
  }, [activeOrderId, sendToKds]);

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Left: Menu grid — 2/3 width */}
      <div className="flex-1 overflow-hidden border-r">
        <MenuGrid onItemSelect={handleItemSelect} />
      </div>

      {/* Right: Order panel — fixed width */}
      <div className="w-80 flex-shrink-0 overflow-hidden flex flex-col">
        <OrderPanel
          order={activeOrder ?? null}
          onSendToKitchen={handleSendToKitchen}
          isSending={sendToKds.isPending}
        />
      </div>
    </div>
  );
}

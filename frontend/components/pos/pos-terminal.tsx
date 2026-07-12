"use client";

import { useState, useCallback } from "react";
import { MenuGrid } from "@/components/pos/menu-grid";
import { OrderPanel } from "@/components/pos/order-panel";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useCreateOrder, useAddItem, useSendToKds, useOrder } from "@/lib/hooks/pos/use-orders";
import type { MenuItem } from "@/lib/models/pos.model";

export function PosTerminal() {
  const { branchId } = useCurrentUser();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const createOrder = useCreateOrder();
  const { data: activeOrder } = useOrder(activeOrderId ?? "");
  const addItem = useAddItem(activeOrderId ?? "");
  const sendToKds = useSendToKds(activeOrderId ?? "");

  const handleItemSelect = useCallback(
    async (item: MenuItem) => {
      let orderId = activeOrderId;

      if (!orderId) {
        const clientOrderId = crypto.randomUUID();
        const newOrder = await createOrder.mutateAsync({
          branchId,
          clientOrderId,
          type: "DINE_IN",
          coverCount: 1,
        });
        orderId = newOrder.id;
        setActiveOrderId(orderId);
      }

      await addItem.mutateAsync({
        menuItemId: item.id,
        branchId,
        quantity: 1,
      });
    },
    [activeOrderId, branchId, createOrder, addItem]
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

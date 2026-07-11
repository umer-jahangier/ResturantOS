"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MenuGrid } from "@/components/pos/menu-grid";
import { OrderPanel } from "@/components/pos/order-panel";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useCreateOrder, useAddItem, useSendToKds, useOrder } from "@/lib/hooks/pos/use-orders";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { enqueue } from "@/lib/offline/outbox";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { MenuItem } from "@/lib/models/pos.model";

export function PosTerminal() {
  const { branchId } = useCurrentUser();
  const { isOnline } = useOnlineStatus();
  const queryClient = useQueryClient();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const createOrder = useCreateOrder();
  const { data: activeOrder } = useOrder(activeOrderId ?? "");
  const addItem = useAddItem(activeOrderId ?? "");
  const sendToKds = useSendToKds(activeOrderId ?? "");

  const handleItemSelect = useCallback(
    async (item: MenuItem) => {
      const orderId = activeOrderId;

      if (!orderId) {
        // useAddItem below is bound to the (still-null) activeOrderId from this
        // render, so the very first item on a brand-new order can't go through
        // that stale mutation — add it directly here instead (mirroring
        // useAddItem's own online/offline branching).
        const clientOrderId = crypto.randomUUID();
        const newOrder = await createOrder.mutateAsync({
          branchId,
          clientOrderId,
          type: "DINE_IN",
          coverCount: 1,
        });
        setActiveOrderId(newOrder.id);
        const payload = { menuItemId: item.id, branchId, quantity: 1 };
        if (!isOnline) {
          await enqueue({ type: "APPEND_ITEMS", clientOrderId: newOrder.id, payload });
        } else {
          await PosRepository.addItem(newOrder.id, payload);
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.pos.order(branchId, newOrder.id) });
        return;
      }

      await addItem.mutateAsync({
        menuItemId: item.id,
        branchId,
        quantity: 1,
      });
    },
    [activeOrderId, branchId, createOrder, addItem, queryClient, isOnline]
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

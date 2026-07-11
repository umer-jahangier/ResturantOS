"use client";

import { useState } from "react";
import { useMockGrn, usePurchaseOrder } from "@/lib/hooks/purchasing/use-purchasing";

export function MockGrnReceivePanel({ poId }: { poId: string }) {
  const { data: po } = usePurchaseOrder(poId);
  const mockReceive = useMockGrn(poId);
  const [qty, setQty] = useState("100");

  if (!po || po.status === "FULLY_RECEIVED") return null;

  return (
    <div className="rounded border border-dashed border-amber-400 bg-amber-50 p-4">
      <h3 className="font-medium">Mock goods receipt (dev)</h3>
      <p className="text-sm text-muted-foreground">Simulates Phase 8 GRN while integration-mode=mock.</p>
      <div className="mt-2 flex gap-2">
        <input
          className="rounded border px-2 py-1 text-sm"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label="Received quantity"
        />
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
          disabled={mockReceive.isPending}
          onClick={() =>
            mockReceive.mutate(
              po.lines.map((l) => ({ poLineId: l.id, receivedQty: qty })),
            )
          }
        >
          Mock receive
        </button>
      </div>
    </div>
  );
}

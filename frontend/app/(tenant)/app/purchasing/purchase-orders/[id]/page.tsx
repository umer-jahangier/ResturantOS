"use client";

import { useState } from "react";
import Link from "next/link";
import { MockGrnReceivePanel } from "@/components/purchasing/MockGrnReceivePanel";
import { useClosePurchaseOrder, usePurchaseOrder } from "@/lib/hooks/purchasing/use-purchasing";

export default function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const { data: po, isLoading } = usePurchaseOrder(params.id);
  const closePo = useClosePurchaseOrder(params.id);
  const [closeReason, setCloseReason] = useState("");

  if (isLoading || !po) return <p>Loading PO…</p>;

  const canClose = po.status === "FULLY_RECEIVED" || po.status === "PARTIALLY_RECEIVED";
  const isShortClose = po.status === "PARTIALLY_RECEIVED";
  const closeDisabled = closePo.isPending || (isShortClose && closeReason.trim().length === 0);

  return (
    <div className="space-y-4">
      <Link href="/app/purchasing/vendors" className="text-sm text-primary">← Vendors</Link>
      <h1 className="text-xl font-semibold">PO {po.id.slice(0, 8)}…</h1>
      <p>Status: {po.status}</p>
      {po.status === "CLOSED" && po.closedAt && (
        <p className="text-sm text-muted-foreground">
          Closed {new Date(po.closedAt).toLocaleString()}
          {po.closeReason ? ` — ${po.closeReason}` : ""}
        </p>
      )}
      <MockGrnReceivePanel poId={po.id} />
      {canClose && (
        <div className="rounded border p-4">
          <h3 className="font-medium">Close PO</h3>
          {isShortClose && (
            <>
              <p className="text-sm text-muted-foreground">
                This PO was only partially received. Short-closing requires a reason and is subject to
                approval.
              </p>
              <input
                className="mt-2 w-full rounded border px-2 py-1 text-sm"
                placeholder="Reason for short-close"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                aria-label="Short-close reason"
              />
            </>
          )}
          <button
            type="button"
            className="mt-2 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            disabled={closeDisabled}
            onClick={() => closePo.mutate(isShortClose ? closeReason.trim() : undefined)}
          >
            Close PO
          </button>
        </div>
      )}
    </div>
  );
}

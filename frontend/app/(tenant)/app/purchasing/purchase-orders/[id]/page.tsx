"use client";

import Link from "next/link";
import { MockGrnReceivePanel } from "@/components/purchasing/MockGrnReceivePanel";
import { usePurchaseOrder } from "@/lib/hooks/purchasing/use-purchasing";

export default function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const { data: po, isLoading } = usePurchaseOrder(params.id);
  if (isLoading || !po) return <p>Loading PO…</p>;
  return (
    <div className="space-y-4">
      <Link href="/app/purchasing/vendors" className="text-sm text-primary">← Vendors</Link>
      <h1 className="text-xl font-semibold">PO {po.id.slice(0, 8)}…</h1>
      <p>Status: {po.status}</p>
      <MockGrnReceivePanel poId={po.id} />
    </div>
  );
}

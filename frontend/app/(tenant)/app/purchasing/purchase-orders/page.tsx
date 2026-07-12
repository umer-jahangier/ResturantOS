"use client";

import { useState } from "react";
import Link from "next/link";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { usePurchaseOrders } from "@/lib/hooks/purchasing/use-purchasing";
import { PO_STATUSES, type PoStatus } from "@/lib/api-client/schemas/purchasing.schema";
import { PurchaseOrderFormDialog } from "@/components/purchasing/PurchaseOrderFormDialog";
import { PoStatusBadge } from "@/components/purchasing/PoStatusBadge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

const STATUS_FILTER_OPTIONS: { value: "" | PoStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  ...PO_STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") })),
];

/** PO list page — the inbound link `purchase-orders/[id]` has never had (10-12 gap closure). */
export default function PurchaseOrdersPage() {
  const { branchId } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<"" | PoStatus>("");

  const { data, isLoading } = usePurchaseOrders(branchId, statusFilter ? [statusFilter] : undefined);
  const purchaseOrders = data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | PoStatus)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <PurchaseOrderFormDialog trigger={<Button>New Purchase Order</Button>} />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : purchaseOrders.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No purchase orders yet"
          description='Use "New Purchase Order" to raise your first order for a vendor.'
        />
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">PO number</th>
              <th className="py-2 font-medium">Expected date</th>
              <th className="py-2 font-medium">Total</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id} className="border-b hover:bg-muted/50">
                <td className="py-2">
                  <Link
                    href={`/app/purchasing/purchase-orders/${po.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {po.id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="py-2">{po.expectedDeliveryDate ?? "—"}</td>
                <td className="py-2">
                  <MoneyDisplay paisa={po.totalPaisa} />
                </td>
                <td className="py-2">
                  <PoStatusBadge status={po.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

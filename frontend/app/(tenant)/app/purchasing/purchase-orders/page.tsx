"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { usePurchaseOrders } from "@/lib/hooks/purchasing/use-purchasing";
import type { PurchaseOrder } from "@/lib/adapters/purchasing.adapter";
import { PO_STATUSES, type PoStatus } from "@/lib/models/purchasing-status";
import { PurchaseOrderFormDialog } from "@/components/purchasing/PurchaseOrderFormDialog";
import { PoStatusBadge } from "@/components/purchasing/PoStatusBadge";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { dropEmptyColumns } from "@/components/ui/data-grid/columns";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

const STATUS_FILTER_OPTIONS: { value: "" | PoStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  ...PO_STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") })),
];

/**
 * A short, stable reference for a purchase order.
 *
 * <p><b>This is a stopgap and it is labelled as one.</b> The endpoint exposes no PO number — see
 * `isUuid`'s docblock for the measured field list — so there is no human identifier to show. The
 * column is headed "Reference" rather than "PO number", because a heading that promises a
 * business identifier the system does not have is the part that misleads a buyer. Recorded in
 * `38-AUDIT.md` §10.1c as backend work.
 */
function poReference(po: { id: string }): string {
  return po.id.slice(0, 8).toUpperCase();
}

/** PO list page — the inbound link `purchase-orders/[id]` has never had (10-12 gap closure). */
export default function PurchaseOrdersPage() {
  const { branchId } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<"" | PoStatus>("");

  // GA-001: `data ?? []` turned a failed read into "No purchase orders yet" — on the screen a
  // buyer uses to check what is already on order before raising another one.
  const poQuery = usePurchaseOrders(branchId, statusFilter ? [statusFilter] : undefined);
  const purchaseOrders = poQuery.data ?? [];

  const columns = useMemo<ColumnDef<PurchaseOrder, unknown>[]>(() => {
    const all: ColumnDef<PurchaseOrder, unknown>[] = [
      {
        id: "reference",
        header: "Reference",
        cell: ({ row }) => (
          <Link
            href={`/app/purchasing/purchase-orders/${row.original.id}`}
            className="font-mono font-medium text-primary underline-offset-2 hover:underline"
          >
            {poReference(row.original)}
          </Link>
        ),
      },
      {
        accessorKey: "submittedAt",
        header: "Submitted",
        cell: ({ row }) =>
          row.original.submittedAt
            ? new Date(row.original.submittedAt).toLocaleDateString()
            : "Not submitted",
      },
      { accessorKey: "expectedDeliveryDate", header: "Expected date" },
      {
        accessorKey: "totalPaisa",
        header: "Total",
        cell: ({ row }) => <MoneyDisplay paisa={row.original.totalPaisa} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <PoStatusBadge status={row.original.status} />,
      },
    ];
    // UI-SPEC §7.2 — a column with no data on ANY row is not rendered. "Expected date" survives
    // this today on the strength of a single populated row out of 84, which is the correct
    // outcome: one real value means the field is in use, and hiding it would hide a buyer's entry.
    return dropEmptyColumns(all, purchaseOrders, (row, id) => row[id as keyof PurchaseOrder]);
  }, [purchaseOrders]);

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Purchase orders"
        actions={
          <>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | PoStatus)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-small focus-visible:border-ring"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <PurchaseOrderFormDialog trigger={<Button>New Purchase Order</Button>} />
          </>
        }
      />

      <QueryBoundary
        className="mt-4"
        query={poQuery}
        what="purchase orders"
        isEmpty={purchaseOrders.length === 0}
        loading={
          <div className="mt-4 grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
        empty={
          <EmptyState
            className="mt-4"
            title="No purchase orders yet"
            description='Use "New Purchase Order" to raise your first order for a vendor.'
          />
        }
      >
        <DataGrid
          label="Purchase orders"
          columns={columns}
          data={purchaseOrders}
          density="comfortable"
          pageSize={25}
          isFiltered={statusFilter !== ""}
          onClearFilters={() => setStatusFilter("")}
          card={{
            primary: (po) => (
              <Link
                href={`/app/purchasing/purchase-orders/${po.id}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {poReference(po)}
              </Link>
            ),
            secondary: (po) => po.status.replaceAll("_", " ").toLowerCase(),
            trailing: (po) => <MoneyDisplay paisa={po.totalPaisa} />,
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}

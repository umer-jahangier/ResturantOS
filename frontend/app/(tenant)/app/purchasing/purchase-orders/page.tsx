"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Clock, FileEdit, Wallet } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { usePurchaseOrders, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { countLine, statLine } from "@/lib/format/stat-line";
import type { PurchaseOrder } from "@/lib/adapters/purchasing.adapter";
import { PO_STATUSES, type PoStatus } from "@/lib/models/purchasing-status";
import { PurchaseOrderFormDialog } from "@/components/purchasing/PurchaseOrderFormDialog";
import { PoStatusBadge } from "@/components/purchasing/PoStatusBadge";
import { poReference } from "@/components/purchasing/po-reference";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { dropEmptyColumns } from "@/components/ui/data-grid/columns";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

/** `FilterBar` prepends its own "All statuses" entry, so this list carries only real states. */
const STATUS_FILTER_OPTIONS = PO_STATUSES.map((s) => ({
  value: s as string,
  label: s.replaceAll("_", " ").toLowerCase(),
}));

/** PO list page — the inbound link `purchase-orders/[id]` has never had (10-12 gap closure). */
export default function PurchaseOrdersPage() {
  const { branchId } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<"" | PoStatus>("");

  // GA-001: `data ?? []` turned a failed read into "No purchase orders yet" — on the screen a
  // buyer uses to check what is already on order before raising another one.
  const poQuery = usePurchaseOrders(branchId, statusFilter ? [statusFilter] : undefined);
  const purchaseOrders = useMemo(() => poQuery.data ?? [], [poQuery.data]);

  // The list carried a `vendorId` and nothing else, so every row named its supplier with a UUID
  // stub. The vendor list is a separate cached read on the same service — joining here is what
  // turns "9958faba…" into a supplier a buyer recognises.
  const vendorsQuery = useVendors();
  const vendorNameById = useMemo(
    () => new Map((vendorsQuery.data ?? []).map((v) => [v.id, v.name] as const)),
    [vendorsQuery.data],
  );

  // Derived from `purchaseOrders` — the identical array the grid renders below, so the header
  // and the table can never state different totals.
  const draftCount = purchaseOrders.filter((po) => po.status === "DRAFT").length;
  const awaitingCount = purchaseOrders.filter((po) => po.status === "PENDING_APPROVAL").length;
  const committedPaisa = purchaseOrders.reduce((sum, po) => sum + po.totalPaisa, 0);

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
        id: "vendor",
        header: "Vendor",
        cell: ({ row }) =>
          vendorNameById.get(row.original.vendorId) ??
          // Not a UUID stub and not a blank: the order is real, the supplier's name simply is
          // not on this screen yet (the vendor list is still loading, or the vendor was removed).
          (vendorsQuery.isLoading ? "…" : "Unknown vendor"),
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
    //
    // `valueOf` MUST resolve the synthetic column ids too. It did not, and the consequence was
    // invisible: `row["reference"]` is `undefined` on every purchase order, `isEmpty(undefined)`
    // is `true`, so `dropEmptyColumns` removed the REFERENCE COLUMN ITSELF from every non-empty
    // list — the very column 38-02 added to stop the screen printing UUIDs. A list of purchase
    // orders with no identifier column at all reads as a rendering choice rather than a bug,
    // which is why nothing caught it until a test asserted the reference was on screen.
    return dropEmptyColumns(all, purchaseOrders, (row, id) => {
      if (id === "reference") return row.id;
      if (id === "vendor") return row.vendorId;
      return row[id as keyof PurchaseOrder];
    });
  }, [purchaseOrders, vendorNameById, vendorsQuery.isLoading]);

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Purchase orders"
        description="What is on order for this branch, and where each order has reached."
        meta={statLine(
          countLine(purchaseOrders.length, "purchase order"),
          awaitingCount > 0 ? `${awaitingCount} awaiting approval` : null,
          statusFilter ? `Filtered to ${statusFilter.replaceAll("_", " ").toLowerCase()}` : null,
        )}
        actions={<PurchaseOrderFormDialog trigger={<Button>New Purchase Order</Button>} />}
      />

      <div className="grid gap-(--space-md) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={statusFilter ? "Orders shown" : "Purchase orders"}
          value={purchaseOrders.length.toLocaleString()}
          icon={ClipboardList}
          accent="primary"
        />
        <StatTile label="Draft" value={draftCount.toLocaleString()} icon={FileEdit} />
        <StatTile
          label="Awaiting approval"
          value={awaitingCount.toLocaleString()}
          icon={Clock}
          higherIsBetter={false}
        />
        <StatTile
          label="Value of orders shown"
          value={<MoneyDisplay paisa={committedPaisa} />}
          icon={Wallet}
          accent="secondary"
        />
      </div>

      <FilterBar
        title="Purchase orders"
        filters={[
          {
            id: "status",
            label: "Status",
            value: statusFilter,
            onChange: (value) => setStatusFilter(value as "" | PoStatus),
            options: STATUS_FILTER_OPTIONS,
          },
        ]}
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
            secondary: (po) =>
              [vendorNameById.get(po.vendorId), po.status.replaceAll("_", " ").toLowerCase()]
                .filter(Boolean)
                .join(" · "),
            trailing: (po) => <MoneyDisplay paisa={po.totalPaisa} />,
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}

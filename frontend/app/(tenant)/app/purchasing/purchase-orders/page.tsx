"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Clock, FileEdit, Wallet } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { usePurchaseOrders, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { filteredCountLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
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
  //
  // ONE UNFILTERED READ, narrowed in the browser — the shape `inventory/stock/page.tsx` already
  // uses, and it is load-bearing here for two separate reasons.
  //
  // 1. The tiles below count STATUSES and the filter selects a STATUS. Asking the server to
  //    narrow the list meant "Awaiting approval" was derived from an array that, under
  //    `statusFilter="DRAFT"`, could not contain a single PENDING_APPROVAL order — so that tile
  //    was not merely wrong under a filter, it was structurally always 0 while orders really
  //    were waiting to be approved. Fetching a SECOND, unfiltered list beside this one would fix
  //    the number and reintroduce the very drift the comment below is guarding against; one
  //    array cannot disagree with itself.
  // 2. The server-side filter never worked anyway. `PurchaseOrderController:42` declares
  //    `@RequestParam(required = false) List<PoStatus> status`, which binds `?status=DRAFT`,
  //    while axios serialises an array param as `?status[]=DRAFT`. Spring found no parameter
  //    named `status`, `required = false` swallowed the absence, and the whole list came back —
  //    so choosing a status changed nothing on screen. Narrowing here is the first time this
  //    control does anything at all.
  const poQuery = usePurchaseOrders(branchId);
  const allPurchaseOrders = useMemo(() => poQuery.data ?? [], [poQuery.data]);
  const purchaseOrders = useMemo(
    () =>
      statusFilter
        ? allPurchaseOrders.filter((po) => po.status === statusFilter)
        : allPurchaseOrders,
    [allPurchaseOrders, statusFilter],
  );

  // The list carried a `vendorId` and nothing else, so every row named its supplier with a UUID
  // stub. The vendor list is a separate cached read on the same service — joining here is what
  // turns "9958faba…" into a supplier a buyer recognises.
  const vendorsQuery = useVendors();
  const vendorNameById = useMemo(
    () => new Map((vendorsQuery.data ?? []).map((v) => [v.id, v.name] as const)),
    [vendorsQuery.data],
  );

  // Two bases, and every figure states on its own tile which one it is counting.
  //
  // `purchaseOrders` is the identical array the grid renders below, so anything labelled "shown"
  // is derived from it and the header can never state a total the table contradicts. The STATUS
  // counts come from `allPurchaseOrders` instead, because they answer a question the reader's
  // filter does not change: "is anything waiting for me to approve it?" is a fact about the
  // branch, not about whichever slice a buyer is currently looking at. A tile reading 0 because
  // of the filter the reader just set is the screen contradicting itself.
  const draftCount = allPurchaseOrders.filter((po) => po.status === "DRAFT").length;
  const awaitingCount = allPurchaseOrders.filter((po) => po.status === "PENDING_APPROVAL").length;
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
        // `filteredCountLine`, not `countLine` (stat-line.ts:20-25): a narrowed list that states
        // only its own size makes a filtered screen and an empty branch look identical. And the
        // exception clause counts the WHOLE branch, so filtering to any status other than
        // PENDING_APPROVAL no longer deletes the one line an approver reads this header for.
        meta={statLine(
          filteredCountLine(purchaseOrders.length, allPurchaseOrders.length, "purchase order"),
          awaitingCount > 0 ? `${awaitingCount} awaiting approval` : null,
          statusFilter ? `Filtered to ${statusFilter.replaceAll("_", " ").toLowerCase()}` : null,
        )}
        actions={<PurchaseOrderFormDialog trigger={<Button>New Purchase Order</Button>} />}
      />

      <div className="grid gap-(--space-md) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={statusFilter ? "Orders shown" : "Purchase orders"}
          value={formatNumber(purchaseOrders.length)}
          icon={ClipboardList}
          accent="primary"
        />
        {/* Both count every order in the branch. Under a filter they say so, because a
            branch-wide figure sitting unmarked beside a filtered one leaves the reader unable to
            tell which tiles moved with their filter and which did not. */}
        <StatTile
          label={statusFilter ? "Draft (all orders)" : "Draft"}
          value={formatNumber(draftCount)}
          icon={FileEdit}
        />
        <StatTile
          label={statusFilter ? "Awaiting approval (all orders)" : "Awaiting approval"}
          value={formatNumber(awaitingCount)}
          icon={Clock}
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
        // The BRANCH's count, not the filtered one. Filtering to a status nobody has used yet is
        // not an empty branch, and "No purchase orders yet · raise your first order" is the wrong
        // sentence to show a buyer who has 84 of them. Letting the filtered-empty case fall
        // through to `DataGrid` gets UI-SPEC §8.3's separate state, which offers a way back out.
        isEmpty={allPurchaseOrders.length === 0}
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

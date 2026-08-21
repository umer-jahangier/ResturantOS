"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useVendorInvoices, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { countLine, statLine } from "@/lib/format/stat-line";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/models/purchasing-status";
import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";
import { VendorInvoiceFormDialog } from "@/components/purchasing/VendorInvoiceFormDialog";
import { MatchStatusBadge } from "@/components/purchasing/ThreeWayMatchTable";
import { poReference } from "@/components/purchasing/po-reference";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

/** `FilterBar` prepends its own "All statuses" entry, so this list carries only real states. */
const STATUS_FILTER_OPTIONS = INVOICE_STATUSES.map((s) => ({
  value: s as string,
  label: s.replaceAll("_", " ").toLowerCase(),
}));

/**
 * Invoice list page — the inbound link `invoices/[id]` (and its ThreeWayMatchTable) has never
 * had (UAT gaps 4/5/6/8). "Book Invoice" is the first caller of the previously-dead
 * `PurchasingRepository.createInvoice`.
 *
 * <p>Migrated off a hand-rolled `<table>` (plan 38-07 task 1). Two identifier columns changed
 * with it: "Vendor" printed `vendorId.slice(0, 8)` and "PO" printed `purchaseOrderId.slice(0, 8)`,
 * so an accounts-payable clerk reconciling a paper invoice against this screen had a UUID prefix
 * to match against a supplier's letterhead. The vendor is now named, and the PO carries the same
 * `poReference` spelling the purchase-order list uses.
 */
export default function VendorInvoicesPage() {
  const { branchId } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<"" | InvoiceStatus>("");

  // GA-001: `data ?? []` collapsed failure into "No vendor invoices yet" — telling accounts
  // payable there is nothing to pay.
  const invoicesQuery = useVendorInvoices(branchId, statusFilter ? [statusFilter] : undefined);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  const vendorsQuery = useVendors();
  const vendorNameById = useMemo(
    () => new Map((vendorsQuery.data ?? []).map((v) => [v.id, v.name] as const)),
    [vendorsQuery.data],
  );

  // Both derived from `invoices`, the array the grid renders — the header cannot outrun the table.
  const mismatchedCount = invoices.filter((i) => i.status === "MISMATCHED").length;
  const totalPaisa = invoices.reduce((sum, i) => sum + i.totalPaisa + i.inputTaxPaisa, 0);

  const columns: ColumnDef<VendorInvoice, unknown>[] = [
    {
      accessorKey: "invoiceNo",
      header: "Invoice #",
      cell: ({ row }) => (
        <Link
          href={`/app/purchasing/invoices/${row.original.id}`}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {row.original.invoiceNo}
        </Link>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      cell: ({ row }) =>
        vendorNameById.get(row.original.vendorId) ??
        (vendorsQuery.isLoading ? "…" : "Unknown vendor"),
    },
    {
      id: "purchaseOrder",
      header: "PO",
      cell: ({ row }) => (
        <Link
          href={`/app/purchasing/purchase-orders/${row.original.purchaseOrderId}`}
          className="font-mono text-primary underline-offset-2 hover:underline"
        >
          {poReference({ id: row.original.purchaseOrderId })}
        </Link>
      ),
    },
    { accessorKey: "invoiceDate", header: "Invoice date" },
    {
      accessorKey: "totalPaisa",
      header: "Total",
      cell: ({ row }) => <MoneyDisplay paisa={row.original.totalPaisa} />,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <MatchStatusBadge status={row.original.status} />,
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Vendor invoices"
        description="What suppliers have billed this branch, and how each invoice matched its order and receipt."
        meta={statLine(
          countLine(invoices.length, "invoice"),
          mismatchedCount > 0 ? `${mismatchedCount} mismatched` : null,
          statusFilter ? `Filtered to ${statusFilter.replaceAll("_", " ").toLowerCase()}` : null,
        )}
        actions={<VendorInvoiceFormDialog trigger={<Button>Book Invoice</Button>} />}
      />

      <FilterBar
        title="Invoices"
        filters={[
          {
            id: "status",
            label: "Status",
            value: statusFilter,
            onChange: (value) => setStatusFilter(value as "" | InvoiceStatus),
            options: STATUS_FILTER_OPTIONS,
          },
        ]}
        actions={
          invoices.length > 0 ? (
            <span className="text-small text-foreground-secondary">
              Billed:{" "}
              <MoneyDisplay paisa={totalPaisa} className="text-foreground" />
            </span>
          ) : null
        }
      />

      <QueryBoundary
        query={invoicesQuery}
        what="vendor invoices"
        isEmpty={invoices.length === 0 && statusFilter === ""}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
        empty={
          <EmptyState
            title="No vendor invoices yet"
            description='Use "Book Invoice" to invoice a sent purchase order and run the 3-way match.'
          />
        }
      >
        <DataGrid
          label="Vendor invoices"
          columns={columns}
          data={invoices}
          density="comfortable"
          pageSize={25}
          isFiltered={statusFilter !== ""}
          onClearFilters={() => setStatusFilter("")}
          card={{
            primary: (invoice) => (
              <Link
                href={`/app/purchasing/invoices/${invoice.id}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {invoice.invoiceNo}
              </Link>
            ),
            secondary: (invoice) =>
              [vendorNameById.get(invoice.vendorId), invoice.invoiceDate]
                .filter(Boolean)
                .join(" · "),
            trailing: (invoice) => <MoneyDisplay paisa={invoice.totalPaisa} />,
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}

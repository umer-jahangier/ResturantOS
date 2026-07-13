"use client";

import { useState } from "react";
import Link from "next/link";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useVendorInvoices } from "@/lib/hooks/purchasing/use-purchasing";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/api-client/schemas/purchasing.schema";
import { VendorInvoiceFormDialog } from "@/components/purchasing/VendorInvoiceFormDialog";
import { MatchStatusBadge } from "@/components/purchasing/ThreeWayMatchTable";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

const STATUS_FILTER_OPTIONS: { value: "" | InvoiceStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  ...INVOICE_STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") })),
];

/**
 * Invoice list page — the inbound link `invoices/[id]` (and its ThreeWayMatchTable) has never
 * had (UAT gaps 4/5/6/8). "Book Invoice" is the first caller of the previously-dead
 * `PurchasingRepository.createInvoice`.
 */
export default function VendorInvoicesPage() {
  const { branchId } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<"" | InvoiceStatus>("");

  const { data, isLoading } = useVendorInvoices(branchId, statusFilter ? [statusFilter] : undefined);
  const invoices = data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Vendor invoices</h1>
        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | InvoiceStatus)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <VendorInvoiceFormDialog trigger={<Button>Book Invoice</Button>} />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No vendor invoices yet"
          description='Use "Book Invoice" to invoice a sent purchase order and run the 3-way match.'
        />
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Invoice #</th>
              <th className="py-2 font-medium">Vendor</th>
              <th className="py-2 font-medium">PO</th>
              <th className="py-2 font-medium">Invoice date</th>
              <th className="py-2 font-medium">Total</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b hover:bg-muted/50">
                <td className="py-2">
                  <Link
                    href={`/app/purchasing/invoices/${invoice.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {invoice.invoiceNo}
                  </Link>
                </td>
                <td className="py-2">{invoice.vendorId.slice(0, 8)}…</td>
                <td className="py-2">
                  <Link
                    href={`/app/purchasing/purchase-orders/${invoice.purchaseOrderId}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {invoice.purchaseOrderId.slice(0, 8)}…
                  </Link>
                </td>
                <td className="py-2">{invoice.invoiceDate}</td>
                <td className="py-2">
                  <MoneyDisplay paisa={invoice.totalPaisa} />
                </td>
                <td className="py-2">
                  <MatchStatusBadge status={invoice.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, ReceiptText, Wallet } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useVendorInvoices, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import { countLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";
import { MatchStatusBadge } from "@/components/purchasing/ThreeWayMatchTable";
import { ApPaymentDialog } from "@/components/purchasing/ApPaymentDialog";
import { poReference } from "@/components/purchasing/po-reference";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

/**
 * Whole days since the invoice was dated.
 *
 * <h3>Why this is not `lib/format/elapsed.ts`</h3>
 *
 * The shared elapsed formatter is deliberately BOUNDED: it stops counting at 24 hours and prints
 * a date past 30 days, because a kitchen ticket older than a day is history rather than work.
 * Accounts payable is the opposite case — the whole point of an ageing column is that the count
 * keeps going, and `45` is the number a clerk acts on. Running an invoice through the bounded
 * formatter would render the most overdue bill on the screen as `7 Aug 2026`, which is the one
 * fact that column must never degrade into. So this stays, unchanged, as the AP-specific reading.
 */
function daysOutstanding(invoiceDate: string): number {
  const then = new Date(invoiceDate).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

/**
 * The Payments tab 10-11 added (previously 404'd). Shows the payables worklist -- invoices with
 * status MATCHED or APPROVED_FOR_PAYMENT -- plus recently PAID invoices so a user can see the
 * result of what they just did. No `GET /payments` list endpoint exists on the backend
 * (`ApPaymentController` is POST-only), so this page is driven off the invoice list, not a
 * separate payment-history query (see PurchasingRepository.createApPayment's doc comment).
 */
export default function ApPaymentsPage() {
  const { branchId } = useCurrentUser();
  // GA-001: `data ?? []` fanned out into BOTH sections, so one failed read produced "Nothing to
  // pay right now" and "No payments recorded yet." simultaneously — two confident all-clears from
  // a single 500, on the screen that decides whether suppliers get paid.
  const invoicesQuery = useVendorInvoices(branchId, ["MATCHED", "APPROVED_FOR_PAYMENT", "PAID"]);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  const vendorsQuery = useVendors();
  const vendorNameById = useMemo(
    () => new Map((vendorsQuery.data ?? []).map((v) => [v.id, v.name] as const)),
    [vendorsQuery.data],
  );
  const vendorName = (invoice: VendorInvoice) =>
    vendorNameById.get(invoice.vendorId) ?? (vendorsQuery.isLoading ? "…" : "Unknown vendor");

  const [search, setSearch] = useState("");

  // Both lists are derived inline rather than through a memoised PREDICATE: a `useMemo` that
  // returns a function cannot be memoised safely (React Compiler refuses it outright), and the
  // filtering here is over a page of invoices, not a data set worth caching.
  const needle = search.trim().toLowerCase();
  const matches = (invoice: VendorInvoice) =>
    needle === "" ||
    invoice.invoiceNo.toLowerCase().includes(needle) ||
    (vendorNameById.get(invoice.vendorId) ?? "").toLowerCase().includes(needle);

  const payable = invoices
    .filter((i) => i.status === "MATCHED" || i.status === "APPROVED_FOR_PAYMENT")
    .filter(matches);
  const paid = invoices.filter((i) => i.status === "PAID").filter(matches);

  // The amount actually owed on an invoice is total plus input tax — the same sum the grid's
  // Amount column prints, so the tile and the rows cannot disagree.
  const owedPaisa = payable.reduce((sum, i) => sum + i.totalPaisa + i.inputTaxPaisa, 0);
  const oldestDays = payable.reduce((max, i) => Math.max(max, daysOutstanding(i.invoiceDate)), 0);

  const invoiceLink = (invoice: VendorInvoice) => (
    <Link
      href={`/app/purchasing/invoices/${invoice.id}`}
      className="font-medium text-primary underline-offset-2 hover:underline"
    >
      {invoice.invoiceNo}
    </Link>
  );

  const payableColumns: ColumnDef<VendorInvoice, unknown>[] = [
    { id: "invoiceNo", header: "Invoice #", cell: ({ row }) => invoiceLink(row.original) },
    { id: "vendor", header: "Vendor", cell: ({ row }) => vendorName(row.original) },
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
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <MoneyDisplay paisa={row.original.totalPaisa + row.original.inputTaxPaisa} />
      ),
    },
    {
      id: "age",
      header: "Days outstanding",
      cell: ({ row }) => {
        const days = daysOutstanding(row.original.invoiceDate);
        return (
          <span className="tabular-nums">
            {days} {days === 1 ? "day" : "days"}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <MatchStatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ApPaymentDialog invoice={row.original} />
        </div>
      ),
    },
  ];

  const paidColumns: ColumnDef<VendorInvoice, unknown>[] = [
    { id: "invoiceNo", header: "Invoice #", cell: ({ row }) => invoiceLink(row.original) },
    { id: "vendor", header: "Vendor", cell: ({ row }) => vendorName(row.original) },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <MoneyDisplay paisa={row.original.totalPaisa + row.original.inputTaxPaisa} />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <MatchStatusBadge status={row.original.status} />,
    },
  ];

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Accounts payable"
        description="Vendor invoices ready to pay — matched or approved for payment."
        meta={statLine(
          countLine(payable.length, "invoice") + " to pay",
          oldestDays > 0 ? `Oldest ${oldestDays} days` : null,
          paid.length > 0 ? `${paid.length} recently paid` : null,
        )}
      />

      <div className="grid gap-(--space-md) sm:grid-cols-3">
        <StatTile
          label="Invoices to pay"
          value={formatNumber(payable.length)}
          icon={ReceiptText}
          accent="primary"
        />
        <StatTile
          label="Owed on these invoices"
          value={<MoneyDisplay paisa={owedPaisa} />}
          icon={Wallet}
          accent="secondary"
        />
        {/* The demo's fourth tile here would be "Average days to pay". This system records no
            payment date on an invoice — `ApPaymentController` is POST-only and nothing reads
            back when a payment settled — so there is no honest source for it and it renders as
            a stated absence rather than a plausible-looking number (D-38-16). */}
        <StatTile
          label="Average days to pay"
          unavailableReason="Payments are recorded but not read back, so no settlement date exists to average."
          icon={Clock}
        />
      </div>

      <FilterBar
        title="Payables"
        search={{
          value: search,
          onChange: setSearch,
          label: "Search payables",
          placeholder: "Search by invoice # or vendor…",
        }}
      />

      <QueryBoundary
        query={invoicesQuery}
        what="vendor invoices"
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
      >
        <div className="space-y-(--space-xl)">
          <section className="space-y-(--space-sm)">
            <h2 className="text-label font-semibold tracking-wide uppercase text-foreground-secondary">
              Payable
            </h2>
            {payable.length === 0 && search.trim() === "" ? (
              <EmptyState
                title="Nothing to pay right now"
                description="Book and match a vendor invoice to see it here."
              />
            ) : (
              <DataGrid
                label="Invoices payable"
                columns={payableColumns}
                data={payable}
                density="comfortable"
                isFiltered={search.trim() !== ""}
                onClearFilters={() => setSearch("")}
                card={{
                  primary: (invoice) => invoiceLink(invoice),
                  secondary: (invoice) =>
                    `${vendorName(invoice)} · ${daysOutstanding(invoice.invoiceDate)} days`,
                  trailing: (invoice) => (
                    <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} />
                  ),
                  actions: (invoice) => <ApPaymentDialog invoice={invoice} />,
                }}
              />
            )}
          </section>

          <section className="space-y-(--space-sm)">
            <h2 className="text-label font-semibold tracking-wide uppercase text-foreground-secondary">
              Recently paid
            </h2>
            {paid.length === 0 ? (
              <p className="text-small text-muted-foreground">
                {search.trim() === ""
                  ? "No payments recorded yet."
                  : "No paid invoices match this search."}
              </p>
            ) : (
              <DataGrid
                label="Recently paid invoices"
                columns={paidColumns}
                data={paid}
                density="comfortable"
                isFiltered={search.trim() !== ""}
                onClearFilters={() => setSearch("")}
                card={{
                  primary: (invoice) => invoiceLink(invoice),
                  secondary: (invoice) => vendorName(invoice),
                  trailing: (invoice) => (
                    <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} />
                  ),
                }}
              />
            )}
          </section>
        </div>
      </QueryBoundary>
    </PageBody>
  );
}

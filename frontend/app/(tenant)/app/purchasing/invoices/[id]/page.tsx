"use client";

import { use } from "react";
import Link from "next/link";

import { MatchStatusBadge, ThreeWayMatchTable } from "@/components/purchasing/ThreeWayMatchTable";
import { OverrideMatchDialog } from "@/components/purchasing/OverrideMatchDialog";
import { useVendorInvoice } from "@/lib/hooks/purchasing/use-purchasing";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoiceQuery = useVendorInvoice(id);
  const { data: invoice, isLoading } = invoiceQuery;

  /*
   * Three outcomes, told apart (UI-SPEC §8).
   *
   * This was one line — `if (isLoading || !invoice) return <p>Loading invoice…</p>` — and it
   * folded all three into the worst of them. A failed request leaves `invoice` undefined with
   * `isLoading` false, so the screen said "Loading invoice…" FOREVER: no cause, no retry, and
   * nothing a person could tell whoever they telephoned. An invoice that genuinely is not there
   * got the same sentence. A reader cannot act on a state the product will not name.
   */
  if (invoiceQuery.isError) {
    return (
      <div className="space-y-4">
        <Link href="/app/purchasing/invoices" className="text-small text-primary">
          ← Vendor invoices
        </Link>
        <QueryErrorNotice
          what="this vendor invoice"
          moduleLabel="Purchasing"
          error={invoiceQuery.error}
          onRetry={() => void invoiceQuery.refetch()}
          isRetrying={invoiceQuery.isFetching}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading invoice">
        {/* Matched to the header, the total line and the match table below it, so the page does
            not jump when the invoice lands (UI-SPEC §24). */}
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <Link href="/app/purchasing/invoices" className="text-small text-primary">
          ← Vendor invoices
        </Link>
        <EmptyState
          title="That invoice is not here"
          description="It may have been removed, or the link may be pointing at another branch."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/app/purchasing/invoices" className="text-sm text-primary">
        ← Vendor invoices
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Invoice {invoice.invoiceNo}</h1>
        <MatchStatusBadge status={invoice.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        Total{" "}
        <MoneyDisplay
          paisa={invoice.totalPaisa + invoice.inputTaxPaisa}
          className="text-foreground"
        />
        {" · PO "}
        <Link
          href={`/app/purchasing/purchase-orders/${invoice.purchaseOrderId}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {invoice.purchaseOrderId.slice(0, 8)}…
        </Link>
      </p>
      {invoice.matchOverrideReason && (
        <p className="text-sm text-muted-foreground">
          Match overridden: {invoice.matchOverrideReason}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {invoice.status === "MISMATCHED" && <OverrideMatchDialog invoiceId={invoice.id} />}
      </div>
      {(invoice.status === "MATCHED" || invoice.status === "APPROVED_FOR_PAYMENT") && (
        <p className="text-sm text-muted-foreground">
          This invoice is payable — pay it from{" "}
          <Link
            href="/app/purchasing/payments"
            className="text-primary underline-offset-2 hover:underline"
          >
            Payments
          </Link>
          .
        </p>
      )}

      <ThreeWayMatchTable invoice={invoice} />
    </div>
  );
}

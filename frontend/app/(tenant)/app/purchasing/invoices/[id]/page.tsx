"use client";

import { use } from "react";
import Link from "next/link";

import { MatchStatusBadge, ThreeWayMatchTable } from "@/components/purchasing/ThreeWayMatchTable";
import { OverrideMatchDialog } from "@/components/purchasing/OverrideMatchDialog";
import { useVendorInvoice } from "@/lib/hooks/purchasing/use-purchasing";
import { MoneyDisplay } from "@/components/ui/money-display";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: invoice, isLoading } = useVendorInvoice(id);
  if (isLoading || !invoice) return <p>Loading invoice…</p>;

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
        Total <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} className="text-foreground" />
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
          <Link href="/app/purchasing/payments" className="text-primary underline-offset-2 hover:underline">
            Payments
          </Link>
          .
        </p>
      )}

      <ThreeWayMatchTable invoice={invoice} />
    </div>
  );
}

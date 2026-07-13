"use client";

import Link from "next/link";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useVendorInvoices } from "@/lib/hooks/purchasing/use-purchasing";
import { MatchStatusBadge } from "@/components/purchasing/ThreeWayMatchTable";
import { ApPaymentDialog } from "@/components/purchasing/ApPaymentDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/ui/money-display";

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
  const { data, isLoading } = useVendorInvoices(branchId, [
    "MATCHED",
    "APPROVED_FOR_PAYMENT",
    "PAID",
  ]);
  const invoices = data ?? [];
  const payable = invoices.filter((i) => i.status === "MATCHED" || i.status === "APPROVED_FOR_PAYMENT");
  const paid = invoices.filter((i) => i.status === "PAID");

  if (isLoading) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Accounts payable</h1>
        <p className="text-sm text-muted-foreground">
          Vendor invoices ready to pay -- matched or approved for payment.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Payable</h2>
        {payable.length === 0 ? (
          <EmptyState
            title="Nothing to pay right now"
            description="Book and match a vendor invoice to see it here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Invoice #</th>
                <th className="py-2 font-medium">Vendor</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Days outstanding</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {payable.map((invoice) => (
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
                    <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} />
                  </td>
                  <td className="py-2">{daysOutstanding(invoice.invoiceDate)}</td>
                  <td className="py-2">
                    <MatchStatusBadge status={invoice.status} />
                  </td>
                  <td className="py-2">
                    <ApPaymentDialog invoice={invoice} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Recently paid</h2>
        {paid.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Invoice #</th>
                <th className="py-2 font-medium">Vendor</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((invoice) => (
                <tr key={invoice.id} className="border-b">
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
                    <MoneyDisplay paisa={invoice.totalPaisa + invoice.inputTaxPaisa} />
                  </td>
                  <td className="py-2">
                    <MatchStatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

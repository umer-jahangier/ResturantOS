"use client";

import { ThreeWayMatchTable } from "@/components/purchasing/ThreeWayMatchTable";
import { useVendorInvoice } from "@/lib/hooks/purchasing/use-purchasing";

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { data: invoice, isLoading } = useVendorInvoice(params.id);
  if (isLoading || !invoice) return <p>Loading invoice…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Invoice {invoice.invoiceNo}</h1>
      <p>Status: {invoice.status}</p>
      <ThreeWayMatchTable invoice={invoice} />
    </div>
  );
}

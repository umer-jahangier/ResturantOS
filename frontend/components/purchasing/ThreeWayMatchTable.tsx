"use client";

import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";

// Shared by both line-level LineMatchStatus (OK/QTY_OVER/QTY_UNDER/PRICE_OVER/PRICE_UNDER/
// MISSING_GRN/PENDING, LineMatchStatus.java) and invoice-level InvoiceStatus (PENDING_MATCH/
// MATCHED/MISMATCHED/APPROVED_FOR_PAYMENT/PAID, InvoiceStatus.java) — one badge component reused
// for both, per the plan's explicit "do not write a third badge" instruction.
const GREEN = "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
const STATUS_COLOR: Record<string, string> = {
  OK: GREEN,
  PENDING: "bg-muted text-muted-foreground",
  QTY_OVER: AMBER,
  QTY_UNDER: AMBER,
  PRICE_OVER: AMBER,
  PRICE_UNDER: AMBER,
  MISSING_GRN: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  PENDING_MATCH: "bg-muted text-muted-foreground",
  MATCHED: GREEN,
  MISMATCHED: AMBER,
  APPROVED_FOR_PAYMENT: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  PAID: GREEN,
};

export function MatchStatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? "bg-muted text-muted-foreground";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function ThreeWayMatchTable({ invoice }: { invoice: VendorInvoice }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2">PO qty / price</th>
          <th className="py-2">GRN qty</th>
          <th className="py-2">Invoice qty / price</th>
          <th className="py-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {invoice.lines.map((line) => (
          <tr key={line.id} className="border-b">
            <td className="py-2">{line.poQty ?? "—"} @ {line.poUnitPricePaisa ?? "—"}</td>
            <td className="py-2">{line.grnQty ?? "0"}</td>
            <td className="py-2">{line.qty} @ {line.unitPricePaisa}</td>
            <td className="py-2"><MatchStatusBadge status={line.matchStatus} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

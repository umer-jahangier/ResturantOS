"use client";

import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";

const STATUS_COLOR: Record<string, string> = {
  OK: "bg-green-100 text-green-800",
  MISSING_GRN: "bg-red-100 text-red-800",
  PRICE_OVER: "bg-amber-100 text-amber-800",
  MISMATCHED: "bg-amber-100 text-amber-800",
  MATCHED: "bg-green-100 text-green-800",
};

export function MatchStatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? "bg-gray-100 text-gray-800";
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

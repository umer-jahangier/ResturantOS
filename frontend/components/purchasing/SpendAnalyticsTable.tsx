"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import type { SpendAnalytics } from "@/lib/adapters/purchasing.adapter";

function DeltaPct({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls = deltaPct >= 0 ? "text-green-700" : "text-red-700";
  const sign = deltaPct >= 0 ? "+" : "";
  return <span className={cls}>{sign}{deltaPct.toFixed(1)}%</span>;
}

export function SpendAnalyticsTable({
  title,
  buckets,
}: {
  title: string;
  buckets: SpendAnalytics["byVendor"] | SpendAnalytics["byCategory"];
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Label</th>
            <th className="py-2">Current</th>
            <th className="py-2">Prior</th>
            <th className="py-2">Delta %</th>
          </tr>
        </thead>
        <tbody>
          {buckets.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-3 text-muted-foreground">No spend in this period.</td>
            </tr>
          ) : (
            buckets.map((bucket) => (
              <tr key={bucket.id ?? bucket.label} className="border-b">
                <td className="py-2 font-medium">{bucket.label}</td>
                <td className="py-2"><MoneyDisplay paisa={bucket.spendPaisa} /></td>
                <td className="py-2"><MoneyDisplay paisa={bucket.priorSpendPaisa} /></td>
                <td className="py-2"><DeltaPct deltaPct={bucket.deltaPct} /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { MoneyDisplay } from "@/components/ui/money-display";
import type { SpendAnalytics } from "@/lib/adapters/purchasing.adapter";

function DeltaPct({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls = deltaPct >= 0 ? "text-green-700" : "text-red-700";
  const sign = deltaPct >= 0 ? "+" : "";
  return (
    <span className={cls}>
      {sign}
      {deltaPct.toFixed(1)}%
    </span>
  );
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
      <h2 className="text-label font-semibold tracking-[0.08em] uppercase text-foreground-secondary">
        {title}
      </h2>
      {/*
        `table-stack` (globals.css): below `md` each vendor becomes a bordered card with its four
        figures labelled, instead of four money columns squeezed into 342px. The vendor names this
        table carries are long ("Karachi Fresh Foods (Pvt) Ltd"), which is what makes the desktop
        layout unreadable on a phone rather than merely tight.
      */}
      <table className="table-stack mt-2 w-full text-sm">
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
              <td colSpan={4} className="py-3 text-muted-foreground">
                No spend in this period.
              </td>
            </tr>
          ) : (
            buckets.map((bucket) => (
              <tr key={bucket.id ?? bucket.label} className="border-b">
                <td className="py-2 font-medium" data-label="Label">
                  {bucket.label}
                </td>
                <td className="py-2" data-label="Current">
                  <MoneyDisplay paisa={bucket.spendPaisa} />
                </td>
                <td className="py-2" data-label="Prior">
                  <MoneyDisplay paisa={bucket.priorSpendPaisa} />
                </td>
                <td className="py-2" data-label="Delta %">
                  <DeltaPct deltaPct={bucket.deltaPct} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { MoneyDisplay } from "@/components/ui/money-display";
import type { ArAging } from "@/lib/models/finance.model";

interface ArAgingTableProps {
  aging: ArAging;
}

/**
 * FIN-05 AR half (10-18): bucketed AR aging (Current / 31-60 / 61-90 / Over 90) with a total
 * row — same bucket boundaries as ApAgingTable (decision 10-18-A) so the two reports read the
 * same way, but a SEPARATE component: ApAgingTable is typed directly to ApAging (totalApPaisa),
 * not generic over its DTO, so it cannot be reused as-is for ArAging (totalArPaisa) without
 * forking its prop type anyway. Kept as a thin, near-identical sibling rather than adding a
 * generics layer to ApAgingTable that only this one new caller would use.
 */
function ArAgingTable({ aging }: ArAgingTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Bucket</th>
            <th className="py-2 pr-4 font-medium">Days</th>
            <th className="py-2 pr-4 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {aging.buckets.map((bucket) => {
            const isOverdue = bucket.label.toLowerCase().includes("over");
            return (
              <tr
                key={bucket.label}
                className={cn("border-b", isOverdue && "bg-destructive/10")}
              >
                <td className={cn("py-2 pr-4 font-medium", isOverdue && "text-destructive")}>
                  {bucket.label}
                </td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">
                  {bucket.maxDays >= 999_999
                    ? `${bucket.minDays}+ days`
                    : `${bucket.minDays}-${bucket.maxDays} days`}
                </td>
                <td className="py-2 pr-4 text-right">
                  <MoneyDisplay
                    paisa={bucket.amountPaisa}
                    className={isOverdue ? "text-destructive" : undefined}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-2 pr-4" colSpan={2}>
              Total receivables
            </td>
            <td className="py-2 pr-4 text-right">
              <MoneyDisplay paisa={aging.totalArPaisa} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export { ArAgingTable };

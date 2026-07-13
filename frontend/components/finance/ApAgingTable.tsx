"use client";

import { cn } from "@/lib/utils";
import { MoneyDisplay } from "@/components/ui/money-display";
import type { ApAging } from "@/lib/models/finance.model";

interface ApAgingTableProps {
  aging: ApAging;
}

/** FIN-05: bucketed AP aging (Current / 31-60 / 61-90 / Over 90) with a total row. */
function ApAgingTable({ aging }: ApAgingTableProps) {
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
            // "Over 90" is the whole point of an aging report — make overdue money obvious (04-04-B).
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
              Total payables
            </td>
            <td className="py-2 pr-4 text-right">
              <MoneyDisplay paisa={aging.totalApPaisa} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export { ApAgingTable };

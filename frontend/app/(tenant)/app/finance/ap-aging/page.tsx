"use client";

import { useApAging } from "@/lib/hooks/finance/use-finance";
import { ApAgingTable } from "@/components/finance/ApAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ap-aging — first frontend consumer of GET /api/v1/finance/ap/aging.
export default function ApAgingPage() {
  // GA-001: `isError || … every(amountPaisa === 0)` reported "No outstanding payables" when the
  // request failed. Telling a business it owes nobody anything is not a neutral default.
  const apAging = useApAging();
  const aging = apAging.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AP Aging</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding payables bucketed by how overdue they are.
        </p>
      </div>

      <QueryBoundary
        query={apAging}
        what="AP aging"
        isEmpty={!aging || aging.buckets.every((b) => b.amountPaisa === 0)}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <FinanceEmptyState
            title="No outstanding payables"
            description="AP aging buckets will appear here once vendor invoices are booked."
          />
        }
      >
        {aging && <ApAgingTable aging={aging} />}
      </QueryBoundary>
    </div>
  );
}

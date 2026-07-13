"use client";

import { useApAging } from "@/lib/hooks/finance/use-finance";
import { ApAgingTable } from "@/components/finance/ApAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ap-aging — first frontend consumer of GET /api/v1/finance/ap/aging.
export default function ApAgingPage() {
  const { data: aging, isLoading, isError } = useApAging();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AP Aging</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding payables bucketed by how overdue they are.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : isError || !aging || aging.buckets.every((b) => b.amountPaisa === 0) ? (
        <FinanceEmptyState
          title="No outstanding payables"
          description="AP aging buckets will appear here once vendor invoices are booked."
        />
      ) : (
        <ApAgingTable aging={aging} />
      )}
    </div>
  );
}

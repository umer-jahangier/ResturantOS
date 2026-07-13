"use client";

import { useArAging } from "@/lib/hooks/finance/use-finance";
import { ArAgingTable } from "@/components/finance/ArAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ar-aging — first frontend consumer of GET /api/v1/finance/ar/aging.
export default function ArAgingPage() {
  const { data: aging, isLoading, isError } = useArAging();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding house-account charges bucketed by how overdue they are.
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
          title="No outstanding receivables"
          description="AR aging buckets will appear here once a house account is charged."
        />
      ) : (
        <ArAgingTable aging={aging} />
      )}
    </div>
  );
}

"use client";

import { useArAging } from "@/lib/hooks/finance/use-finance";
import { ArAgingTable } from "@/components/finance/ArAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ar-aging — first frontend consumer of GET /api/v1/finance/ar/aging.
export default function ArAgingPage() {
  // GA-001: an outage rendered "No outstanding receivables" — i.e. nobody owes you money. This is
  // a collections screen; a false all-clear here is money left uncollected.
  const arAging = useArAging();
  const aging = arAging.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <p className="text-sm text-muted-foreground">
          Outstanding house-account charges bucketed by how overdue they are.
        </p>
      </div>

      <QueryBoundary
        query={arAging}
        what="AR aging"
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
            title="No outstanding receivables"
            description="AR aging buckets will appear here once a house account is charged."
          />
        }
      >
        {aging && <ArAgingTable aging={aging} />}
      </QueryBoundary>
    </div>
  );
}

"use client";

import { useApAging } from "@/lib/hooks/finance/use-finance";
import { countLine, statLine } from "@/lib/format/stat-line";
import { MoneyDisplay } from "@/components/ui/money-display";
import { ApAgingTable } from "@/components/finance/ApAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ap-aging — first frontend consumer of GET /api/v1/finance/ap/aging.
export default function ApAgingPage() {
  // GA-001: `isError || … every(amountPaisa === 0)` reported "No outstanding payables" when the
  // request failed. Telling a business it owes nobody anything is not a neutral default.
  const apAging = useApAging();
  const aging = apAging.data;
  const overduePaisa = (aging?.buckets ?? []).reduce(
    (sum, b) => (b.label.toLowerCase().includes("over") ? sum + b.amountPaisa : sum),
    0,
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="AP Aging"
        description="Outstanding payables bucketed by how overdue they are."
        /*
         * The `·`-separated stat subtitle. Every count in it RECONCILES with the grid beneath —
         * the bucket count is the rows, the total is the ledger total row, and the overdue figure
         * is the sum of exactly the rows the grid paints red. Nothing here is a second source.
         */
        meta={
          aging ? (
            <>
              {statLine(countLine(aging.buckets.length, "bucket"))}
              {" · Total outstanding "}
              <MoneyDisplay paisa={aging.totalApPaisa} />
              {" · "}
              <MoneyDisplay paisa={overduePaisa} />
              {" overdue"}
            </>
          ) : undefined
        }
      />

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
    </PageBody>
  );
}

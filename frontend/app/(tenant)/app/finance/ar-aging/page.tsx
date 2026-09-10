"use client";

import { useArAging } from "@/lib/hooks/finance/use-finance";
import { countLine, statLine } from "@/lib/format/stat-line";
import { MoneyDisplay } from "@/components/ui/money-display";
import { ArAgingTable } from "@/components/finance/ArAgingTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";

// URL: /app/finance/ar-aging — first frontend consumer of GET /api/v1/finance/ar/aging.
export default function ArAgingPage() {
  // GA-001: an outage rendered "No outstanding receivables" — i.e. nobody owes you money. This is
  // a collections screen; a false all-clear here is money left uncollected.
  const arAging = useArAging();
  const aging = arAging.data;
  const overduePaisa = (aging?.buckets ?? []).reduce(
    (sum, b) => (b.label.toLowerCase().includes("over") ? sum + b.amountPaisa : sum),
    0,
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="AR Aging"
        description="Outstanding house-account charges bucketed by how overdue they are."
        /* Counts reconcile with the grid beneath — see the note on the AP screen. */
        meta={
          aging ? (
            <>
              {statLine(countLine(aging.buckets.length, "bucket"))}
              {" · Total outstanding "}
              <MoneyDisplay paisa={aging.totalArPaisa} />
              {" · "}
              <MoneyDisplay paisa={overduePaisa} />
              {" overdue"}
            </>
          ) : undefined
        }
      />

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
    </PageBody>
  );
}

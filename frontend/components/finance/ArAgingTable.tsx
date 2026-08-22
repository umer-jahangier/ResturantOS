"use client";

import { AgingGrid } from "@/components/finance/AgingGrid";
import type { ArAging } from "@/lib/models/finance.model";

interface ArAgingTableProps {
  aging: ArAging;
}

/**
 * FIN-05 AR half (10-18): bucketed AR aging, on the same bucket boundaries as
 * {@link ApAgingTable} (decision 10-18-A) so the two reports read the same way.
 *
 * <p>They now also SHARE their implementation ({@link AgingGrid}). The two DTOs still differ by
 * one field name — `totalArPaisa` here, `totalApPaisa` there — and that difference is read at
 * this boundary and handed on as a number.
 */
function ArAgingTable({ aging }: ArAgingTableProps) {
  return (
    <AgingGrid
      label="Accounts receivable aging"
      buckets={aging.buckets}
      totalPaisa={aging.totalArPaisa}
      totalLabel="Total receivables"
      totalNote="Stated by finance-service across every bucket above."
    />
  );
}

export { ArAgingTable };

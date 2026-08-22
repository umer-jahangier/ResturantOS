"use client";

import { AgingGrid } from "@/components/finance/AgingGrid";
import type { ApAging } from "@/lib/models/finance.model";

interface ApAgingTableProps {
  aging: ApAging;
}

/**
 * FIN-05: bucketed AP aging (Current / 31-60 / 61-90 / Over 90) with a stated total.
 *
 * <p>The markup lives in {@link AgingGrid}, shared with {@link ArAgingTable} — see that file for
 * why the fork was closed. The total is `totalApPaisa` exactly as the server sent it; this
 * component adds nothing up.
 */
function ApAgingTable({ aging }: ApAgingTableProps) {
  return (
    <AgingGrid
      label="Accounts payable aging"
      buckets={aging.buckets}
      totalPaisa={aging.totalApPaisa}
      totalLabel="Total payables"
      totalNote="Stated by finance-service across every bucket above."
    />
  );
}

export { ApAgingTable };

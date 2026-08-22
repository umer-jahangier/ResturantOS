import { StatusBadge } from "@/components/ui/status-badge";
import type { PeriodStatus } from "@/lib/models/finance.model";

interface PeriodStatusChipProps {
  status: PeriodStatus;
}

/**
 * An accounting period's state.
 *
 * <h3>Why this is now four lines</h3>
 *
 * It was a sixth, local badge implementation — its own rounded pill, its own font size, and its
 * own eight raw palette literals (`bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 …`).
 * Raw palette classes follow neither the theme nor `--brand-h`, so this chip was the one badge in
 * the product that would not move when the identity did, and it drifted from `StatusBadge` in
 * radius, weight and type role. The mapping — the only thing here that was ever about accounting
 * periods — survives; the markup does not.
 *
 * <p>`LOCKED` maps to `warning`, not to `error`. Locking a period is the correct, deliberate end
 * of a month; it is a state to notice before trying to post into it, never a fault.
 */
function PeriodStatusChip({ status }: PeriodStatusChipProps) {
  return <StatusBadge status={status === "OPEN" ? "active" : "warning"} label={status} />;
}

export { PeriodStatusChip };

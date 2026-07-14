import type { PeriodStatus } from "@/lib/models/finance.model";

const CHIP_CLASSES: Record<PeriodStatus, string> = {
  OPEN: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  LOCKED: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

interface PeriodStatusChipProps {
  status: PeriodStatus;
}

function PeriodStatusChip({ status }: PeriodStatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

export { PeriodStatusChip };

import { CheckCircle2, Sparkles, Utensils } from "lucide-react";

import type { TableStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

/**
 * The one spelling of a dining table's RUNTIME state (38-06).
 *
 * <h3>Why this exists</h3>
 *
 * Two surfaces described the same three states with two different vocabularies and two
 * independent colour maps:
 *
 * | surface | before |
 * |---|---|
 * | `table-floor-view.tsx` | its own `STATE_CONFIG` — border + tint + icon + `"Needs Bussing"` |
 * | `app/(tenant)/app/tables/page.tsx` | its own `RUNTIME_STATUS_CLASS`/`RUNTIME_STATUS_LABEL` — pill, **no icon**, `"Needs bussing"` |
 *
 * Same state, two capitalisations, and only one of them carried a non-colour channel. A manager
 * reading `/app/tables` and a waiter reading the floor view were being shown different products.
 *
 * <h3>Three channels, always (UI-SPEC §4.2 / D-38-13)</h3>
 *
 * Every state carries **icon shape + literal text + hue**. The tables page's pill had text and
 * hue only, which is two; and hue is the channel this product has already decided may never be
 * the deciding one — teal(182) sits ΔE2000 18.68 from `--success-600`, the closest pair in the
 * semantic set. Remove the colour and this chip still says which state it is.
 *
 * <h3>Not `StatusBadge`, and the reason is a real gap rather than a preference</h3>
 *
 * `components/ui/status-badge.tsx` has no `AVAILABLE`/`OCCUPIED`/`NEEDS_BUSSING` keys. Its
 * nearest fit is the LEGACY label-only set (`success`/`pending`/`warning`), which renders **no
 * icon** — adopting it would have shipped the two-channel encoding this chip exists to end.
 * Adding three POS keys to the shared badge is a change to a component 38-02/38-01 own and
 * consumed by every module; it is recorded as owed work instead of made here.
 *
 * <h3>Zone</h3>
 *
 * `operational`-safe by construction (D-38-04): no `backdrop-filter`, no animation, no
 * `transform`. The floor view sits on `app/pos/**`, which carries the receipt print path, and a
 * `transform` on any ancestor of `.receipt-root` makes it the containing block for the bill's
 * `position: fixed` and prints the sidebar onto a customer's receipt.
 */

export interface TableStatusDescriptor {
  /** `border-*` for a tile outline. */
  border: string;
  /** Tint fill for a tile. */
  tint: string;
  /** Text/border pair for an inline chip. */
  chip: string;
  icon: typeof CheckCircle2;
  label: string;
}

export const TABLE_STATUS: Record<TableStatus, TableStatusDescriptor> = {
  AVAILABLE: {
    border: "border-success",
    tint: "bg-success/10",
    chip: "bg-success/15 text-success border-success/30",
    icon: CheckCircle2,
    label: "Available",
  },
  OCCUPIED: {
    border: "border-info",
    tint: "bg-info/10",
    chip: "bg-info/15 text-info border-info/30",
    icon: Utensils,
    label: "Occupied",
  },
  NEEDS_BUSSING: {
    border: "border-warning",
    tint: "bg-warning/10",
    chip: "bg-warning/15 text-warning border-warning/30",
    icon: Sparkles,
    label: "Needs bussing",
  },
};

/** Every runtime state, in floor-reading order. Used by the legend and the summary line. */
export const TABLE_STATUS_ORDER: readonly TableStatus[] = [
  "AVAILABLE",
  "OCCUPIED",
  "NEEDS_BUSSING",
];

export function TableStatusChip({
  status,
  className,
}: {
  status: TableStatus;
  className?: string;
}) {
  const descriptor = TABLE_STATUS[status];
  const Icon = descriptor.icon;
  return (
    <span
      data-slot="table-status-chip"
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-label font-medium",
        descriptor.chip,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{descriptor.label}</span>
    </span>
  );
}

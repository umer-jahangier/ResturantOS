import * as React from "react";
import {
  Clock,
  Send,
  CheckCircle2,
  Flame,
  Bell,
  CheckCheck,
  Ban,
  FileEdit,
  CircleDashed,
  Lock,
  Undo2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Legacy generic variants (Finance AccountTable / account detail page) — label-only,
// no icon. Kept exactly as-is for backward compatibility; the phase 07.1 UI-SPEC's
// icon-per-status contract only applies to the POS/KDS status keys below.
// "archived" (08.2, Status System Additions) joins this label-only set — categories/
// ingredients/vendor-items reuse it, not a new icon-bearing variant.
type LegacyStatusVariant =
  | "active"
  | "inactive"
  | "pending"
  | "error"
  | "warning"
  | "success"
  | "archived";

// 7-value line-item status (UI-SPEC "Status System" — item-level).
export type LineItemStatusVariant =
  | "PENDING"
  | "SENT"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "CANCELLED";

// Derived/settlement order-status union (UI-SPEC "Status System" — order-level). SERVED
// is intentionally shared with LineItemStatusVariant above (identical icon/label/hue in
// both tables — see pos.model.ts getOrderDisplayStatus()).
export type OrderStatusVariant =
  | "DRAFT"
  | "IN_PROGRESS"
  | "PARTIALLY_SERVED"
  | "SERVED"
  | "CLOSED"
  | "VOIDED"
  | "REFUNDED";

// 08.2 recipe-coverage 3-state (Status System Additions — COVERED/NO_RECIPE/SCHEDULED).
export type CoverageStatusVariant = "COVERED" | "NO_RECIPE" | "SCHEDULED";

export type StatusVariant =
  | LegacyStatusVariant
  | LineItemStatusVariant
  | OrderStatusVariant
  | CoverageStatusVariant;

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  className?: string;
}

/*
 * Tints re-measured against the demo in wave 38: fill 15% → 10%, border 30% → 20%.
 *
 * The demo's six badge tones are all `-soft` at exactly **0.08** alpha over a hand-written
 * **0.2** border (`DEMO-TOKENS.md` §1e — "solid → -soft at exactly 0.08 alpha → a hand-written
 * 0.2-alpha border", identical across all six hues). Ours were half again as loud, and the
 * consequence was visible on the order list: a table of eleven rows, most of them badged, read
 * as a column of coloured blocks rather than as a column of statuses — the hue stopped being an
 * annotation and became the row's dominant object.
 *
 * 10% rather than the demo's literal 8% because our semantic hues sit at a different lightness
 * than its dark-only palette and 8% disappears against `--card` in light mode. 10% is also what
 * `activity-row.tsx` already uses for the same job, so the two agree.
 *
 * <p>Contrast is unaffected: the INK tokens did not move, and a 10% tint of the same hue behind
 * them shifts the measured ratio by well under a tenth of a stop.
 */
const legacyClassMap: Record<LegacyStatusVariant, string> = {
  active: "bg-success/10 text-success border-success/20",
  success: "bg-success/10 text-success border-success/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  pending: "bg-info/10 text-info border-info/20",
  inactive: "bg-muted text-muted-foreground border-border",
  archived: "bg-muted text-muted-foreground border-border",
};

interface PosStatusDescriptor {
  className: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  /** PREPARING gets a subtle pulse per UI-SPEC ("Flame (filled, subtle pulse)"). */
  pulse?: boolean;
}

// Union type (LineItemStatusVariant | OrderStatusVariant | CoverageStatusVariant) — SERVED
// appears once since both tables specify the identical treatment (success/CheckCheck/"Served").
type PosStatusKey = LineItemStatusVariant | OrderStatusVariant | CoverageStatusVariant;

// Semantic-token-only mapping, never raw Tailwind palette classes (UI-SPEC Color
// contract / DS §18). Color is never the sole channel — every entry pairs a hue with a
// distinct lucide icon AND a text label (WCAG, UI-SPEC "Status System" Rule).
const posStatusMap: Record<PosStatusKey, PosStatusDescriptor> = {
  // ── Line-item status (7) ──────────────────────────────────────────────────
  PENDING: {
    className: "bg-muted text-muted-foreground border-border",
    icon: Clock,
    label: "Pending",
  },
  SENT: {
    className: "bg-info/10 text-info border-info/20",
    icon: Send,
    label: "Sent",
  },
  ACCEPTED: {
    className: "bg-info/10 text-info border-info/20",
    icon: CheckCircle2,
    label: "Accepted",
  },
  PREPARING: {
    className: "bg-info/10 text-info border-info/20",
    icon: Flame,
    label: "Preparing",
    pulse: true,
  },
  READY: {
    className: "bg-success/10 text-success border-success/20",
    icon: Bell,
    label: "Ready",
  },
  SERVED: {
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCheck,
    label: "Served",
  },
  CANCELLED: {
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: Ban,
    label: "Cancelled",
  },
  // ── Derived/settlement order status (distinct keys only — SERVED shared above) ──
  DRAFT: {
    className: "bg-muted text-muted-foreground border-border",
    icon: FileEdit,
    label: "Draft",
  },
  IN_PROGRESS: {
    className: "bg-info/10 text-info border-info/20",
    icon: Flame,
    label: "In Progress",
  },
  PARTIALLY_SERVED: {
    className: "bg-warning/10 text-warning border-warning/20",
    icon: CircleDashed,
    label: "Partially Served",
  },
  CLOSED: {
    className: "bg-muted text-muted-foreground border-border",
    icon: Lock,
    label: "Closed",
  },
  VOIDED: {
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: Ban,
    label: "Voided",
  },
  REFUNDED: {
    className: "bg-warning/10 text-warning border-warning/20",
    icon: Undo2,
    label: "Refunded",
  },
  // ── Recipe-coverage 3-state (08.2 INV-15, UI-SPEC Status System Additions) ──────
  COVERED: {
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCheck,
    label: "Covered",
  },
  NO_RECIPE: {
    className: "bg-warning/10 text-warning border-warning/20",
    icon: AlertTriangle,
    label: "No recipe",
  },
  SCHEDULED: {
    // Label is date-interpolated by the caller via the `label` prop
    // (e.g. `label={`Scheduled from ${formatted}`}`); this default covers the bare case.
    className: "bg-info/10 text-info border-info/20",
    icon: Clock,
    label: "Scheduled",
  },
};

function isPosStatus(status: StatusVariant): status is PosStatusKey {
  return status in posStatusMap;
}

function capitalizeStatus(s: LegacyStatusVariant): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/*
 * `text-label font-semibold` (11px/600) at `px-2 py-0.5` (8px/2px) — the demo's `.badge`
 * measured exactly (`DEMO-COMPONENTS.md:476`: `font-size: 11px; font-weight: 600; padding:
 * 2px 8px; border-radius: 20px`), replacing `text-xs font-medium` at `px-2.5`.
 *
 * <p>Two separate things are bought here. The pill gets one pixel smaller and one weight
 * heavier, which is what a badge should be: a badge ANNOTATES a row, so it has to be legible
 * without competing with the row's own text, and 11px at 600 reads denser and quieter than
 * 12px at 500. And `text-xs` was two of the four G1 violations this file carried
 * (`conformance-baseline.json`) — on the type contract 11px IS a role (`--text-label`), not a
 * Tailwind size that happens to land near one.
 */
function StatusBadge({ status, label, className }: StatusBadgeProps) {
  if (isPosStatus(status)) {
    const descriptor = posStatusMap[status];
    const Icon = descriptor.icon;
    const text = label ?? descriptor.label;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold",
          descriptor.className,
          className,
        )}
        aria-label={text}
      >
        <Icon
          className={cn("size-3.5 shrink-0", descriptor.pulse && "animate-pulse")}
          aria-hidden="true"
        />
        <span>{text}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-label font-semibold",
        legacyClassMap[status],
        className,
      )}
    >
      {label ?? capitalizeStatus(status)}
    </span>
  );
}

export { StatusBadge };

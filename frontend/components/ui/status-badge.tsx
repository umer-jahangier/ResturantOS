import * as React from "react"
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
} from "lucide-react"
import { cn } from "@/lib/utils"

// Legacy generic variants (Finance AccountTable / account detail page) — label-only,
// no icon. Kept exactly as-is for backward compatibility; the phase 07.1 UI-SPEC's
// icon-per-status contract only applies to the POS/KDS status keys below.
type LegacyStatusVariant =
  | "active"
  | "inactive"
  | "pending"
  | "error"
  | "warning"
  | "success"

// 7-value line-item status (UI-SPEC "Status System" — item-level).
export type LineItemStatusVariant =
  | "PENDING"
  | "SENT"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "CANCELLED"

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
  | "REFUNDED"

export type StatusVariant = LegacyStatusVariant | LineItemStatusVariant | OrderStatusVariant

interface StatusBadgeProps {
  status: StatusVariant
  label?: string
  className?: string
}

const legacyClassMap: Record<LegacyStatusVariant, string> = {
  active:
    "bg-success/15 text-success border-success/30",
  success:
    "bg-success/15 text-success border-success/30",
  error:
    "bg-destructive/15 text-destructive border-destructive/30",
  warning:
    "bg-warning/15 text-warning border-warning/30",
  pending:
    "bg-info/15 text-info border-info/30",
  inactive:
    "bg-muted text-muted-foreground border-border",
}

interface PosStatusDescriptor {
  className: string
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
  label: string
  /** PREPARING gets a subtle pulse per UI-SPEC ("Flame (filled, subtle pulse)"). */
  pulse?: boolean
}

// Union type (LineItemStatusVariant | OrderStatusVariant) — SERVED appears once since
// both tables specify the identical treatment (success/CheckCheck/"Served").
type PosStatusKey = LineItemStatusVariant | OrderStatusVariant

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
    className: "bg-info/15 text-info border-info/30",
    icon: Send,
    label: "Sent",
  },
  ACCEPTED: {
    className: "bg-info/15 text-info border-info/30",
    icon: CheckCircle2,
    label: "Accepted",
  },
  PREPARING: {
    className: "bg-info/15 text-info border-info/30",
    icon: Flame,
    label: "Preparing",
    pulse: true,
  },
  READY: {
    className: "bg-success/15 text-success border-success/30",
    icon: Bell,
    label: "Ready",
  },
  SERVED: {
    className: "bg-success/15 text-success border-success/30",
    icon: CheckCheck,
    label: "Served",
  },
  CANCELLED: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
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
    className: "bg-info/15 text-info border-info/30",
    icon: Flame,
    label: "In Progress",
  },
  PARTIALLY_SERVED: {
    className: "bg-warning/15 text-warning border-warning/30",
    icon: CircleDashed,
    label: "Partially Served",
  },
  CLOSED: {
    className: "bg-muted text-muted-foreground border-border",
    icon: Lock,
    label: "Closed",
  },
  VOIDED: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
    icon: Ban,
    label: "Voided",
  },
  REFUNDED: {
    className: "bg-warning/15 text-warning border-warning/30",
    icon: Undo2,
    label: "Refunded",
  },
}

function isPosStatus(status: StatusVariant): status is PosStatusKey {
  return status in posStatusMap
}

function capitalizeStatus(s: LegacyStatusVariant): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function StatusBadge({ status, label, className }: StatusBadgeProps) {
  if (isPosStatus(status)) {
    const descriptor = posStatusMap[status]
    const Icon = descriptor.icon
    const text = label ?? descriptor.label
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
          descriptor.className,
          className
        )}
        aria-label={text}
      >
        <Icon
          className={cn("size-3.5 shrink-0", descriptor.pulse && "animate-pulse")}
          aria-hidden="true"
        />
        <span>{text}</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        legacyClassMap[status],
        className
      )}
    >
      {label ?? capitalizeStatus(status)}
    </span>
  )
}

export { StatusBadge }

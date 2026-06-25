import * as React from "react"
import { cn } from "@/lib/utils"

type StatusVariant =
  | "active"
  | "inactive"
  | "pending"
  | "error"
  | "warning"
  | "success"

interface StatusBadgeProps {
  status: StatusVariant
  label?: string
  className?: string
}

const statusClassMap: Record<StatusVariant, string> = {
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

function capitalizeStatus(s: StatusVariant): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusClassMap[status],
        className
      )}
    >
      {label ?? capitalizeStatus(status)}
    </span>
  )
}

export { StatusBadge }
export type { StatusVariant }

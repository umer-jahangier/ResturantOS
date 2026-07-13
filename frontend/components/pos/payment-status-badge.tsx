import * as React from "react";
import { CheckCircle2, CircleDashed, Dot, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/lib/models/pos.model";

/**
 * The 4-state payment-status chip (POS-22/23/24, 07.3-UI-SPEC "Status System deltas").
 * Distinct from the derived order status / settlement status `StatusBadge` — always
 * rendered as a SEPARATE chip alongside it, never merged. Reuses the DS `StatusBadge`
 * visual system (rounded-full border + icon + label, semantic tokens only, never
 * color-only per WCAG). Also consumed by Order Management (07.3-08) as a list column.
 */
interface PaymentStatusBadgeProps {
  status: PaymentStatus | (string & {});
  className?: string;
}

interface PaymentStatusDescriptor {
  className: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
}

const paymentStatusMap: Record<PaymentStatus, PaymentStatusDescriptor> = {
  PAID: {
    className: "bg-success/15 text-success border-success/30",
    icon: CheckCircle2,
    label: "Paid",
  },
  PARTIALLY_PAID: {
    className: "bg-warning/15 text-warning border-warning/30",
    icon: CircleDashed,
    label: "Partial",
  },
  UNPAID: {
    className: "bg-muted text-muted-foreground border-border",
    icon: Dot,
    label: "Unpaid",
  },
  REFUNDED: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
    icon: Undo2,
    label: "Refunded",
  },
};

// Registry-safety fallback: an unrecognized status value (future backend enum addition,
// transient bad response) renders a safe neutral chip instead of throwing.
const FALLBACK_DESCRIPTOR: PaymentStatusDescriptor = {
  className: "bg-muted text-muted-foreground border-border",
  icon: Dot,
  label: "Unknown",
};

function isKnownPaymentStatus(status: string): status is PaymentStatus {
  return status in paymentStatusMap;
}

export function PaymentStatusBadge({ status, className }: PaymentStatusBadgeProps) {
  const descriptor = isKnownPaymentStatus(status) ? paymentStatusMap[status] : FALLBACK_DESCRIPTOR;
  const Icon = descriptor.icon;

  return (
    <span
      data-testid="payment-status-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        descriptor.className,
        className,
      )}
      aria-label={descriptor.label}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{descriptor.label}</span>
    </span>
  );
}

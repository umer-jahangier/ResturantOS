import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Lock,
  PauseCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { TenantStatus, TenantTier } from "@/lib/models/platform.model";

/**
 * The two chips a tenant row wears, kept on deliberately DIFFERENT channels.
 *
 * <h3>Why status and tier must not look alike</h3>
 *
 * They answer different questions and an operator reads them in different moods. Status is
 * *"can this restaurant take an order right now?"* — a state, so it gets the product's state
 * vocabulary: a semantic hue, a glyph and a word, three channels, exactly as UI-SPEC §4.2 requires
 * of anything carried by colour. Tier is *"what did they buy?"* — a rank, not a state, so it gets
 * the eyebrow voice instead: uppercase, letter-spaced, and no semantic hue at all. Painting a tier
 * in `--success` would put a second green on a row where green already means "serving", and a row
 * with two greens meaning two different things is the kind of thing nobody consciously notices and
 * everybody misreads.
 *
 * <h3>Why `StatusBadge` is not reused for the status half</h3>
 *
 * Its variant union is POS and finance vocabulary — `PENDING`, `SERVED`, `CLOSED`, `VOIDED` — and
 * widening a shared primitive so the control plane can borrow it would push tenant-lifecycle states
 * into every till's type surface. The chip GEOMETRY here is `StatusBadge`'s verbatim
 * (`rounded-full border px-2 py-0.5 text-label font-semibold`, and its `bg-x/10 text-x
 * border-x/20` trio), so the two read as one system without one importing the other.
 */

interface StatusDescriptor {
  className: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
}

const STATUS: Record<TenantStatus, StatusDescriptor> = {
  ACTIVE: {
    className: "border-success/20 bg-success/10 text-success",
    icon: CheckCircle2,
    label: "Active",
  },
  PROVISIONING: {
    className: "border-info/20 bg-info/10 text-info",
    icon: CircleDashed,
    label: "Provisioning",
  },
  // A suspended tenant is reversible; a cancelled one is a decision. Warning against destructive
  // keeps that difference legible in a list where the two words look similar at a glance.
  SUSPENDED: {
    className: "border-warning/20 bg-warning/10 text-warning",
    icon: PauseCircle,
    label: "Suspended",
  },
  CANCELLED: {
    className: "border-destructive/20 bg-destructive/10 text-destructive",
    icon: XCircle,
    label: "Cancelled",
  },
  PURGED: {
    className: "border-border bg-muted text-muted-foreground",
    icon: Lock,
    label: "Closed",
  },
  PROVISIONING_FAILED: {
    className: "border-destructive/20 bg-destructive/10 text-destructive",
    icon: AlertTriangle,
    label: "Provisioning failed",
  },
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const descriptor = STATUS[status];
  const Icon = descriptor.icon;
  return (
    <span
      data-testid={`tenant-status-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold whitespace-nowrap",
        descriptor.className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{descriptor.label}</span>
    </span>
  );
}

/**
 * The one-line consequence of a status, for a surface with room for a sentence.
 *
 * Exported because three places need the same words — the detail header, the lifecycle bar and the
 * list's explanation of what a filter just selected — and three hand-written answers to "what does
 * SUSPENDED mean" is how a console starts disagreeing with itself.
 */
export function tenantStatusConsequence(status: TenantStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Staff can sign in and the point of sale is serving.";
    case "PROVISIONING":
      return "The provisioning saga is still running. Nobody can sign in yet.";
    case "PROVISIONING_FAILED":
      return "The provisioning saga stopped part-way. This tenant has never been usable.";
    case "SUSPENDED":
      return "Every user is locked out and the point of sale is stopped. Nothing is deleted.";
    case "CANCELLED":
      return "Out of service by decision. Data is retained and reactivation is still possible.";
    case "PURGED":
      return "Closed permanently. Records are retained; nothing in this console reopens it.";
  }
}

/** How a tier chip is drawn. `CUSTOM` is dashed because its numbers, not its name, are the plan. */
const TIER: Record<TenantTier, string> = {
  STARTER: "border-border bg-muted text-foreground-secondary",
  GROWTH: "border-primary/25 bg-primary/10 text-primary",
  ENTERPRISE: "border-primary/40 bg-primary/20 text-primary",
  CUSTOM: "border-dashed border-border-strong bg-transparent text-foreground-secondary",
};

export function TierBadge({ tier, className }: { tier: TenantTier; className?: string }) {
  return (
    <span
      data-testid={`tenant-tier-${tier}`}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-label font-semibold tracking-eyebrow uppercase",
        TIER[tier],
        className,
      )}
    >
      {tier}
    </span>
  );
}

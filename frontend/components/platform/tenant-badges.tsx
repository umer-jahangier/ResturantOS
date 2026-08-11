import { cn } from "@/lib/utils";
import type { TenantStatus, TenantTier } from "@/lib/models/platform.model";

// Status and tier chips for the platform console.
//
// Both use only semantic tokens (`--success`, `--warning`, `--destructive`, `--muted`) with the
// same `bg-x/15 text-x border-x/30` trio `StatusBadge` established — no new colours, and no
// bespoke pairings that sit outside the UI-SPEC's measured contrast tables.
//
// `StatusBadge` itself is not reused: its variant union is POS/finance vocabulary
// (`PENDING`, `SERVED`, `CLOSED`…), and widening a shared component owned by another workstream to
// carry tenant-lifecycle states would be an edit outside this phase's boundary for no gain.

const STATUS_STYLES: Record<TenantStatus, string> = {
  ACTIVE: "border-success/30 bg-success/15 text-success",
  PROVISIONING: "border-info/30 bg-info/15 text-info",
  // A suspended tenant is reversible; a cancelled one is a decision. Warning vs destructive keeps
  // that difference legible in a list where the two words look similar at a glance.
  SUSPENDED: "border-warning/30 bg-warning/15 text-warning",
  CANCELLED: "border-destructive/30 bg-destructive/15 text-destructive",
  PURGED: "border-border bg-muted text-muted-foreground",
  PROVISIONING_FAILED: "border-destructive/30 bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<TenantStatus, string> = {
  ACTIVE: "Active",
  PROVISIONING: "Provisioning",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
  PURGED: "Purged",
  PROVISIONING_FAILED: "Provisioning failed",
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return (
    <span
      data-testid={`tenant-status-${status}`}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TierBadge({ tier }: { tier: TenantTier }) {
  return (
    <span
      data-testid={`tenant-tier-${tier}`}
      className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      {tier}
    </span>
  );
}

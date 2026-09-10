import * as React from "react";
import { CalendarClock, CheckCircle2, History, TimerOff, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  subscriptionStatusConsequence,
  subscriptionStatusLabel,
  type SubscriptionStatus,
} from "@/lib/models/platform.model";

/**
 * The chip a subscription wears — and the one hue it is deliberately NOT allowed to wear.
 *
 * <h3>Red belongs to the tenant, not to the subscription</h3>
 *
 * `TenantStatusBadge` paints a CANCELLED tenant in `--destructive`, and it earns that: a cancelled
 * tenant is not serving, its staff cannot sign in and its point of sale is stopped. A cancelled
 * SUBSCRIPTION does none of those things. The backend is explicit about it — cancelling a
 * subscription changes no tenant status, revokes no feature and lowers no ceiling, because
 * conflating the two would let a commercial decision silently take a restaurant's POS offline.
 *
 * <p>So the two must not look alike. If both cancellations rendered red, an operator scanning a
 * console that shows tenant state and subscription state on the same screen would have no way to
 * tell which one they were looking at, and the safest reading — "this restaurant is down" — is the
 * wrong one. Red here is reserved for a restaurant that is not trading; a subscription that ended
 * gets the neutral treatment plus the word.
 *
 * <h3>Three channels, never colour alone</h3>
 *
 * Hue, glyph and word, exactly as `TenantStatusBadge` and `StatusBadge` do it, and the chip geometry
 * is theirs verbatim (`rounded-full border px-2 py-0.5 text-label font-semibold`, with the
 * `bg-x/10 text-x border-x/20` trio) so the three read as one system without importing each other.
 * `StatusBadge` itself is not reused because its variant union is POS and finance vocabulary —
 * `PENDING`, `SERVED`, `VOIDED` — and widening it for the control plane would push subscription
 * states into every till's type surface.
 */

interface SubscriptionStatusDescriptor {
  className: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, SubscriptionStatusDescriptor> = {
  TRIALING: {
    className: "border-info/20 bg-info/10 text-info",
    icon: CalendarClock,
  },
  ACTIVE: {
    className: "border-success/20 bg-success/10 text-success",
    icon: CheckCircle2,
  },
  /*
   * Warning, because this one is a WORKLIST item: the clock ended the trial and nobody has decided
   * what happens next. It changed no entitlement — the tenant is serving exactly as it was — so the
   * amber says "somebody needs to act", which is true, rather than "something is broken", which is
   * not.
   */
  TRIAL_ENDED: {
    className: "border-warning/20 bg-warning/10 text-warning",
    icon: TimerOff,
  },
  CANCELLED: {
    className: "border-border bg-muted text-muted-foreground",
    icon: XCircle,
  },
  /* Superseded by a newer subscription. Dashed, because it is history rather than a live state. */
  ENDED: {
    className: "border-border border-dashed bg-muted text-muted-foreground",
    icon: History,
  },
};

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const descriptor = SUBSCRIPTION_STATUS[status];
  const Icon = descriptor.icon;
  return (
    <span
      data-testid={`subscription-status-${status}`}
      /*
       * The consequence is the tooltip AND the accessible title, because the single most
       * misreadable thing on this console is a subscription status taken for an operational one.
       * "Trial ended" reads like a cut-off; the title says, in words, that no entitlement changed.
       */
      title={subscriptionStatusConsequence(status)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold whitespace-nowrap",
        descriptor.className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{subscriptionStatusLabel(status)}</span>
    </span>
  );
}

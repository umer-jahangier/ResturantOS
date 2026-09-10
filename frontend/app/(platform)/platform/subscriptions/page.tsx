"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { SubscriptionRegisterView } from "@/components/platform/subscription-register";

/**
 * URL: `/platform/subscriptions` — every tenant's commercial arrangement.
 *
 * <h3>The register is the honest replacement for a revenue dashboard</h3>
 *
 * A control plane at this position in a SaaS product usually opens on money: MRR, ARR, churn, failed
 * payments, dunning. **None of those exist here**, and not because they were left for later — this
 * product contains no billing integration at all. Every `@Table` across sixteen services was
 * enumerated: there is no invoice entity, no payment entity, no processor client and no webhook, and
 * a repo-wide search for the usual vendors returns five hits, all of them the string `billing_ref`,
 * a free-text VARCHAR with no foreign key.
 *
 * <p>So this screen shows what is real and measurable instead: which trials lapse soon, which
 * periods have run out without anyone confirming a renewal, which plan changes are booked, which
 * cancellations are scheduled — and, above all, how many tenants have no subscription record at all.
 * Four honest tiles beat a wall of fabricated revenue, and on a control plane a fabricated figure is
 * not merely wrong, it is acted on.
 *
 * <h3>"Period end has passed" is a clock reading, never an accusation</h3>
 *
 * `renewalOverdue` is derived from an elapsed period. The scheduler never rolls a renewal date
 * forward — the backend's own sweep test pins that, precisely because advancing the date would
 * assert a payment nothing observes — so an elapsed period means an operator should look, and a
 * renewal is something a person states on the tenant's own screen.
 */
export default function PlatformSubscriptionsPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Subscriptions"
        description="Trials, renewals, scheduled changes and cancellations across every tenant — and the tenants that have no subscription at all."
      />
      <SubscriptionRegisterView />
    </div>
  );
}

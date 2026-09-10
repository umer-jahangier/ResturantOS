"use client";

import { PageHeader } from "@/components/ui/page-header";
import { AnalyticsGrowth } from "@/components/platform/analytics-growth";
import { AnalyticsUsage } from "@/components/platform/analytics-usage";
import { OverviewCommercial } from "@/components/platform/overview-commercial";
import { OverviewFleet } from "@/components/platform/overview-fleet";
import { OverviewPeople } from "@/components/platform/overview-people";
import { OverviewWindow } from "@/components/platform/overview-window";

/**
 * URL: `/platform/analytics` — growth, distribution and usage across every tenant.
 *
 * <h3>What is new here, and what is deliberately borrowed</h3>
 *
 * Two sections are new because nothing else in the console answers what they answer:
 * {@link AnalyticsGrowth} (the lifecycle series over time) and {@link AnalyticsUsage} (fleet usage
 * measured against fleet entitlement). Both read endpoints the overview never calls.
 *
 * <p>The other four sections are the dashboard's own components, imported unchanged. Tenant
 * population by status and tier, fleet headcount, and plan mix are all things this screen must
 * show — and they are already built, already bounded by their own `QueryBoundary`, and already
 * reading the same React Query cache. Re-implementing them here would produce two components that
 * render the same number from the same endpoint, which is not a second opinion: it is two places
 * for the next change to be applied to one of.
 *
 * <p>The ORDER is what makes this a different screen from the dashboard rather than a copy of it.
 * The dashboard is arranged for triage — how big is the platform, what needs a human today. This
 * one is arranged for measurement: change over time first, then the distribution that change
 * produced, then the capacity that distribution consumes, and finally the provenance of all of it.
 *
 * <h3>The rule every figure on this page obeys</h3>
 *
 * **Where a series has no history, the points that exist are plotted and nothing is back-filled.**
 * A zero and "we did not measure" are different facts; a growth chart that invents its own past is
 * a lie with axes on it. `SparseSeriesChart` breaks its line at an unobserved bucket rather than
 * interpolating through it, and `AnalyticsGrowth` prints each series' observed range and its
 * server-supplied caveat beside the picture.
 *
 * <p>And there is **no revenue anywhere on this screen** — no MRR, ARR, ARPU, churn value or
 * failed-payment figure, not as a number, not as a zero, not as a placeholder chart. This product
 * integrates no billing: `tenants.billing_ref` is a free-text VARCHAR with no foreign key and
 * there is no invoice, payment or price table in any of the sixteen services. `OverviewWindow`'s
 * second card names those metrics with the backend's own reasons attached, which is the only
 * honest way to render them.
 */
export default function PlatformAnalyticsPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Growth & usage"
        description="Every figure here is one the platform actually measures, over the window the server cut. Nothing is back-filled to make a line look continuous."
      />

      <AnalyticsGrowth />
      <OverviewFleet />
      <AnalyticsUsage />

      {/*
        Headcount and plan mix side by side at `lg`. Both are distributions over the same fleet,
        and reading them together is how "we grew by four tenants" turns into "on which tier, with
        how many people". Stacked below `lg` because the plan rows carry a mono plan code beside a
        meter and both would truncate at 768.
      */}
      <div className="grid gap-(--space-md) lg:grid-cols-2">
        <OverviewPeople />
        <OverviewCommercial />
      </div>

      <OverviewWindow />
    </div>
  );
}

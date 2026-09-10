"use client";

import { PageHeader } from "@/components/ui/page-header";
import { OverviewActivity } from "@/components/platform/overview-activity";
import { OverviewAlerts } from "@/components/platform/overview-alerts";
import { OverviewCommercial } from "@/components/platform/overview-commercial";
import { OverviewFleet } from "@/components/platform/overview-fleet";
import { OverviewPeople } from "@/components/platform/overview-people";
import { OverviewSystem } from "@/components/platform/overview-system";
import { OverviewWindow } from "@/components/platform/overview-window";

/**
 * URL: `/platform/dashboard` — the control plane's landing page.
 *
 * <h3>The rule this screen exists to obey</h3>
 *
 * **Every figure on it is one the backend actually returns, and every figure it cannot get is
 * named rather than left blank.** That is not a stylistic preference on a SaaS control plane; it
 * is the difference between a screen decisions get made on and a screen that produces confident
 * wrong decisions. This product has shipped the defect twice already, which is why `StatTile` and
 * `Meter` both refuse at the TYPE level to accept a value and a reason together.
 *
 * <p>Concretely, and verified before a line of this page was written: **there is no billing in
 * this product.** Every `@Table` across sixteen services was enumerated and a repository-wide
 * search for `stripe|paddle|chargebee|razorpay|mrr|arr|plan_price` returns five hits, all of them
 * the string `billing_ref` — a free-text VARCHAR on the tenant row with no foreign key. So there
 * is no revenue tile, no MRR, no ARR, no invoice count, no payment status and no churn value on
 * this page, in any form, including as a zero or as an empty chart. The commercial card shows what
 * IS real — plans, trials, renewals, cancellations and plan mix — and
 * `OverviewWindow`'s second card names the absent figures with the backend's own reasons attached.
 *
 * <h3>Why the page is assembled from independently-bounded sections</h3>
 *
 * Six reads back this screen and they hit four different subsystems, one of which (the user
 * directory) fans out one internal HTTP call per tenant. A single boundary over all six would
 * blank the whole console the moment any one of them was slow or refused. Each section owns its
 * own `QueryBoundary`, so a failing health probe leaves the tenant counts standing and says
 * precisely what could not be read.
 *
 * <p>The one deliberate exception is `OverviewAlerts`, which fails as a UNIT across its three
 * sources — because an alerts list assembled from a partial set of inputs still ends with
 * "nothing else needs attention", and it does not know that.
 *
 * <h3>Order of the page</h3>
 *
 * Orientation, then action, then detail. The fleet strip says how big the platform is; the alerts
 * card says what a human has to do about it today; people, plans, activity and status fill in
 * behind that; and the last row is the provenance — what was counted, over which window, and what
 * could not be counted at all.
 *
 * <h3>"Platform Dashboard", not "Platform overview"</h3>
 *
 * `e2e/journeys/unified-login.spec.ts` asserts this exact heading as the proof that a SuperAdmin
 * login lands on the console — it is the passing assertion that a SuperAdmin has a browser path at
 * all. A nicer noun is not worth turning a green regression test red.
 */
export default function PlatformDashboardPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Platform Dashboard"
        description="Every action taken here affects a whole restaurant group, not one branch."
      />

      <OverviewFleet />
      <OverviewAlerts />
      <OverviewPeople />
      <OverviewCommercial />

      {/*
        Two cards that answer different questions about the same moment — what just happened, and
        what is working right now. Side by side at `lg` and stacked below it; there is no `md`
        two-column step because the service rows carry a mono service id plus a badge and both
        would truncate at 768.
      */}
      <div className="grid gap-(--space-md) lg:grid-cols-2">
        <OverviewActivity />
        <OverviewSystem />
      </div>

      <OverviewWindow />
    </div>
  );
}

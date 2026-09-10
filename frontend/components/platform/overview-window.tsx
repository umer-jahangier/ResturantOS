"use client";

import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { ConsoleSection } from "@/components/platform/console-section";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformAnalyticsOverview } from "@/lib/hooks/use-platform-overview";
import type { AnalyticsOverview, PlatformFigure } from "@/lib/models/platform-overview.model";

/**
 * The two halves of one honest statement: what the platform counted, and what it cannot count.
 *
 * <h3>Why the absences are on the screen at all</h3>
 *
 * `AnalyticsOverviewResponse.unavailableMetrics` is not an oversight in the payload — it is a
 * deliberate list of the figures a control plane would normally show and this product genuinely
 * cannot: MRR, ARR, ARPU, churn value, failed payments, cross-tenant sales. The backend's own
 * reasoning for sending them is the reason for rendering them: *"rather than omit them silently —
 * which invites the next author to 'add the missing MRR tile' — name them and say why, so the
 * absence is part of the contract."*
 *
 * <p>An omitted tile reads as a gap somebody forgot to fill. A named absence with a reason is a
 * decision, and it is the only thing standing between this console and a revenue dashboard
 * computed from nothing. There is no billing in this product: no invoice, no payment, no processor
 * integration, no price on any tier, and `tenants.billing_ref` is a free-text VARCHAR with no
 * foreign key.
 *
 * <h3>The window is the server's, not a caption</h3>
 *
 * `windowFrom` / `windowTo` come back on the response and are printed from it. A hard-coded "last
 * 90 days" label would be a caption free to drift from the number beside it the moment the
 * server's default changes — which is the defect class this whole screen is written against, in
 * miniature.
 *
 * <h3>Every figure carries its provenance</h3>
 *
 * A measured figure's `source` is on the row as a `title`, because several of them are load-bearing
 * caveats rather than trivia: "tenants suspended" is a LOWER BOUND, not a count — the column holds
 * only the most recent suspension and no event is published — and "tenants with a billing
 * reference" counts how many rows a human typed something into, not how many tenants are billed.
 */

/** Day precision: these are window boundaries, and an hour on them implies a precision they lack. */
const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/** Backend figure name → the words a reader knows it by. */
const FIGURE_LABEL: Record<string, string> = {
  tenants_created_in_window: "Tenants created",
  tenants_suspended_in_window: "Tenants suspended",
  tenants_cancelled_in_window: "Tenants cancelled",
  tenants_provisioning_failed: "Provisioning failures, right now",
  trials_ending_in_window: "Trials ending",
  renewals_due_in_window: "Renewals due",
  tenants_with_billing_reference: "Tenants with a billing reference",
  impersonation_sessions_started_in_window: "Impersonation sessions started",
  tenant_lifecycle_timeline: "Tenant lifecycle timeline",
  active_users: "Active users (DAU / MAU)",
  tenant_last_activity: "Tenant last activity",
  mrr: "MRR",
  arr: "ARR",
  arpu: "ARPU",
  churn_value: "Churn value",
  failed_payments: "Failed payments",
  cross_tenant_sales: "Cross-tenant sales",
};

function figureLabel(figure: PlatformFigure): string {
  return FIGURE_LABEL[figure.name] ?? figure.name.replace(/_/g, " ");
}

function measuredFigures(overview: AnalyticsOverview): PlatformFigure[] {
  return [...overview.lifecycle, ...overview.entitlement, ...overview.operations].filter(
    (figure) => figure.state === "measured",
  );
}

/**
 * Everything the platform reported as absent, from all four groups.
 *
 * <p>`unreadable` and `notMeasured` are both here but they are NOT merged into one word: "nothing
 * computes this" is a permanent property of the product, and "the source did not answer on this
 * request" is a live outage somebody can chase. Rendering them identically would tell an operator
 * to stop looking for a fault that exists.
 */
function absentFigures(overview: AnalyticsOverview): PlatformFigure[] {
  return [
    ...overview.lifecycle,
    ...overview.entitlement,
    ...overview.operations,
    ...overview.unavailableMetrics,
  ].filter((figure) => figure.state !== "measured");
}

function MeasuredGrid({ figures }: { figures: PlatformFigure[] }) {
  return (
    <dl className="grid gap-(--space-md) md:grid-cols-2">
      {figures.map((figure) => (
        <div key={figure.name} className="flex flex-col gap-0.5" title={figure.source}>
          <dt className="text-label font-medium tracking-wider text-foreground-secondary">
            {figureLabel(figure)}
          </dt>
          {/* The display serif and tabular figures, the same voice `StatTile` gives a headline
              number — one step down in size because these are supporting counts, not the page's
              headline. */}
          <dd className="font-heading text-h1 font-semibold tabular-nums">
            {formatNumber(figure.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AbsentList({ figures }: { figures: PlatformFigure[] }) {
  return (
    <ul className="flex flex-col gap-(--space-sm)">
      {figures.map((figure) => (
        <li key={figure.name} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-small font-semibold text-foreground">{figureLabel(figure)}</span>
            <span
              className={
                figure.state === "unreadable"
                  ? "text-label font-semibold tracking-wider text-warning uppercase"
                  : "text-label font-semibold tracking-wider text-foreground-tertiary uppercase"
              }
            >
              {figure.state === "unreadable" ? "Source did not answer" : "Not measured"}
            </span>
          </span>
          <span className="text-small text-foreground-tertiary">{figure.source}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewWindow() {
  const overview = usePlatformAnalyticsOverview();
  const data = overview.data;

  return (
    <div className="grid gap-(--space-md) lg:grid-cols-2">
      <ConsoleSection
        anchorId="platform-counted"
        eyebrow="Provenance"
        title="Counted in this window"
        description={
          data
            ? `${formatDateTime(data.windowFrom, DAY)} — ${formatDateTime(data.windowTo, DAY)}, cut by the server. Hover any figure for where it came from.`
            : "The window is the server's and is printed from the response, never restated here."
        }
      >
        <QueryBoundary
          query={overview}
          what="the platform counts"
          moduleLabel="Platform"
          loading={
            <div className="grid gap-(--space-md) md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          }
        >
          {data ? <MeasuredGrid figures={measuredFigures(data)} /> : null}
        </QueryBoundary>
      </ConsoleSection>

      <ConsoleSection
        anchorId="platform-not-shown"
        eyebrow="Provenance"
        title="Not shown here, and why"
        description="Named rather than omitted. A gap reads as an oversight and invites the next author to fill it with a plausible number."
      >
        <QueryBoundary
          query={overview}
          what="the list of unavailable metrics"
          moduleLabel="Platform"
          hideRetry
          loading={
            <div className="flex flex-col gap-(--space-sm)">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          }
        >
          {data ? <AbsentList figures={absentFigures(data)} /> : null}
        </QueryBoundary>
      </ConsoleSection>
    </div>
  );
}

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Meter } from "@/components/ui/meter";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConsoleFact, ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { TierBadge } from "@/components/platform/tenant-badges";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import {
  useSubscriptionHistory,
  useSubscriptionLimits,
  useTenantSubscription,
} from "@/lib/hooks/use-platform-subscription";
import {
  limitLabel,
  limitStateLabel,
  operatorActionLabel,
  type PlanLimitCheck,
  type PlatformTenant,
  type SubscriptionHistoryEntry,
} from "@/lib/models/platform.model";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * The tenant's commercial arrangement: its plan, its trial, its ceilings against real usage, and
 * every transition that got it there.
 *
 * <h3>There is no revenue on this screen and there will not be</h3>
 *
 * A plan carries a `pricePaisa`, and it is rendered — as what the plan is SOLD at, through
 * `MoneyDisplay`, beside a caption that says so. It is never summed, never annualised and never
 * called revenue, because **this product records no invoice, no payment and no processor
 * transaction anywhere**. The backend states that in one place (`SubscriptionDtos
 * .REVENUE_NOT_AVAILABLE`) precisely so a screen can render it verbatim instead of quietly
 * inventing an MRR tile, and this panel takes that offer.
 *
 * <h3>No subscription is a real answer, not an empty card</h3>
 *
 * `subscription: null` comes back 200 with a note. Nothing was backfilled when the registry
 * shipped, because inventing a plan, a price and a start date for an existing tenant would assert a
 * commercial agreement nobody made — so today this is the state of every tenant. The tier still
 * governs entitlement and this panel says which, rather than showing a subscription card with
 * dashes in it that reads as a broken fetch.
 *
 * <h3>Why the limits query is conditional</h3>
 *
 * `GET .../subscription/limits` evaluates a PLAN's ceilings and refuses when there is no live
 * subscription. Firing it regardless would paint a red failure notice on every tenant screen for a
 * state that is not a failure. It runs when there is something to measure against, and the usage
 * panel — which measures against the TIER's ceilings — carries the tenant in the meantime.
 */
export function TenantSubscriptionPanel({ tenant }: { tenant: PlatformTenant }) {
  const subscription = useTenantSubscription(tenant.id);
  const hasSubscription = subscription.data?.subscription != null;
  const limits = useSubscriptionLimits(tenant.id, hasSubscription);

  return (
    <ConsoleSection
      anchorId="subscription"
      eyebrow="Subscription"
      title="Plan, trial and limits"
      description="What this tenant is on, how long it runs, and how its declared ceilings compare with what can actually be measured."
      data-testid="tenant-subscription"
    >
      <div className="flex flex-col gap-(--space-lg)">
        <QueryBoundary
          query={subscription}
          what="this tenant's subscription"
          loading={<Skeleton className="h-24" />}
        >
          {subscription.data ? (
            subscription.data.subscription === null ? (
              <ConsoleNote data-testid="subscription-absent">
                {subscription.data.note ?? "This tenant has no subscription record."} Its
                entitlements come from its tier ({subscription.data.tier}), which is what the
                gateway enforces — the subscription registry is a commercial record layered beside
                that, and nothing was backfilled into it.
              </ConsoleNote>
            ) : (
              <SubscriptionDetailFacts
                detail={subscription.data.subscription}
                tierMatches={subscription.data.planTierMatchesTenantTier}
                tenant={tenant}
              />
            )
          ) : null}
        </QueryBoundary>

        {hasSubscription && (
          <div className="flex flex-col gap-(--space-sm)">
            <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
              Plan limits against usage
            </p>
            <QueryBoundary
              query={limits}
              what="this tenant's plan limits"
              loading={<Skeleton className="h-32" />}
            >
              {limits.data ? (
                <div className="flex flex-col gap-(--space-md)">
                  {/*
                    One banner, not six identical rows. When NOT ONE ceiling can be checked, six
                    "not measured" lines read as six separate omissions instead of the single
                    platform-wide fact they are.
                  */}
                  {!limits.data.anyMeasurable && (
                    <ConsoleNote tone="warning" data-testid="limits-none-measurable">
                      Not one of this plan&apos;s ceilings can be checked from the platform plane
                      right now, so nothing below is a verdict. `exceeded: 0` here means only that
                      nothing we can measure disagrees — it is not a statement that the tenant fits.
                    </ConsoleNote>
                  )}
                  {limits.data.anyMeasurable && limits.data.exceeded > 0 && (
                    <ConsoleNote tone="warning" data-testid="limits-exceeded">
                      {formatNumber(limits.data.exceeded)} measurable ceiling
                      {limits.data.exceeded === 1 ? " is" : "s are"} breached. The tenant keeps
                      everything it already has — a plan gates, it never deletes — but a further
                      downgrade will be refused until this is resolved or forced.
                    </ConsoleNote>
                  )}

                  <ul className="flex flex-col gap-(--space-md)" data-testid="plan-limits">
                    {limits.data.checks.map((check) => (
                      <li key={check.limit} data-testid={`plan-limit-${check.limit}`}>
                        <LimitMeter check={check} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </QueryBoundary>
          </div>
        )}

        <SubscriptionHistory tenantId={tenant.id} />
      </div>
    </ConsoleSection>
  );
}

/**
 * One ceiling as a meter, or as a stated absence.
 *
 * `Meter` requires a denominator and its props are a discriminated union: a null reading has to
 * arrive with a reason, and a reading cannot arrive with one. That is what makes "not measured"
 * impossible to render as a 0%-wide bar — an empty track says "we counted and found none", which
 * for three of these six dimensions would be a lie.
 */
function LimitMeter({ check }: { check: PlanLimitCheck }) {
  const measured =
    (check.state === "WITHIN" || check.state === "EXCEEDED") &&
    check.used !== null &&
    check.ceiling !== null;

  if (!measured) {
    return (
      <Meter
        label={limitLabel(check.limit)}
        value={null}
        of={check.ceiling ?? 0}
        unavailableReason={`${limitStateLabel(check.state)} — ${check.source}`}
      />
    );
  }

  const used = check.used!;
  const ceiling = check.ceiling!;
  const ratio = used / ceiling;

  return (
    <Meter
      label={limitLabel(check.limit)}
      value={used}
      of={ceiling}
      noun={check.unit}
      ofLabel="Plan ceiling"
      status={
        check.state === "EXCEEDED"
          ? { tone: "danger", label: "Over plan" }
          : ratio >= 0.8
            ? { tone: "warning", label: "Near ceiling" }
            : { tone: "success", label: "Within plan" }
      }
    />
  );
}

function SubscriptionDetailFacts({
  detail,
  tierMatches,
  tenant,
}: {
  detail: NonNullable<ReturnType<typeof useTenantSubscription>["data"]>["subscription"];
  tierMatches: boolean | null;
  tenant: PlatformTenant;
}) {
  if (detail === null) return null;
  const plan = detail.plan;

  return (
    <div className="flex flex-col gap-(--space-md)">
      <div className="flex flex-wrap items-center gap-(--space-sm)">
        <StatusBadge
          status={
            detail.status === "ACTIVE"
              ? "active"
              : detail.status === "CANCELLED"
                ? "error"
                : detail.status === "TRIALING"
                  ? "pending"
                  : "warning"
          }
          label={operatorActionLabel(detail.status)}
        />
        {plan ? <TierBadge tier={plan.tier} /> : null}
        {detail.renewalOverdue && (
          <span className="text-small text-warning" data-testid="renewal-overdue">
            Renewal date has passed
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-3">
        <ConsoleFact label="Plan" value={plan?.name} absence="No plan on this subscription" />
        <ConsoleFact label="Plan code" value={plan?.code} absence="Not recorded" mono />
        <ConsoleFact
          label="List price"
          value={
            plan ? (
              <span className="flex flex-wrap items-baseline gap-1">
                <MoneyDisplay paisa={plan.pricePaisa} currency={plan.currency} />
                <span className="text-label font-normal text-foreground-tertiary">
                  per {plan.billingPeriod.toLowerCase()}
                </span>
              </span>
            ) : undefined
          }
          absence="No plan on this subscription"
        />
        <ConsoleFact
          label="Trial ends"
          value={detail.trialEndAt ? formatDateTime(detail.trialEndAt, DATE_ONLY) : undefined}
          absence="Not on trial"
        />
        <ConsoleFact
          label="Trial days remaining"
          value={
            detail.trialDaysRemaining === null
              ? undefined
              : `${formatNumber(detail.trialDaysRemaining)} days`
          }
          absence="No trial running"
        />
        <ConsoleFact
          label="Current period ends"
          value={
            detail.currentPeriodEndAt
              ? formatDateTime(detail.currentPeriodEndAt, DATE_ONLY)
              : undefined
          }
          absence="No period recorded"
        />
        <ConsoleFact
          label="Scheduled change"
          value={
            detail.pendingPlan && detail.pendingChangeAt
              ? `${detail.pendingPlan.code} on ${formatDateTime(detail.pendingChangeAt, DATE_ONLY)}`
              : undefined
          }
          absence="Nothing scheduled"
        />
        <ConsoleFact
          label="Cancellation booked"
          value={detail.cancelAt ? formatDateTime(detail.cancelAt, DATE_ONLY) : undefined}
          absence="Not cancelled"
        />
        <ConsoleFact
          label="Started"
          value={detail.startedAt ? formatDateTime(detail.startedAt, DATE_ONLY) : undefined}
          absence="Not recorded"
        />
      </dl>

      {/*
        The two rows on this screen that name a tier can disagree, and the API surfaces that rather
        than reconciling it: a tier change applied directly through `POST /tenants/{id}/tier` moves
        the tenant while the subscription still names the plan it was sold. Both are real operator
        actions and the product must not guess which one was meant.
      */}
      {tierMatches === false && (
        <ConsoleNote tone="warning" data-testid="tier-mismatch">
          This tenant is on the <span className="font-semibold">{tenant.tier}</span> tier while its
          subscription names a plan on a different one. Entitlement follows the tenant&apos;s tier,
          which is what the gateway enforces; the subscription is the commercial record and it has
          not been moved to match. Neither is automatically corrected, because both were deliberate.
        </ConsoleNote>
      )}

      <ConsoleNote data-testid="revenue-not-available">
        Billing is not integrated: this product records no invoice, payment or processor transaction
        anywhere, so no revenue, MRR, ARR or churn figure can be computed and none is shown. The
        price above is what the plan is sold at, not money received.
      </ConsoleNote>
    </div>
  );
}

/**
 * Every transition of this tenant's plan, tier, trial and renewal, newest first.
 *
 * <h3>What this replaces</h3>
 *
 * `tenants.tier` used to be a column an operator overwrote with no record of the previous value
 * anywhere in the product — no event, no timestamp, and platform_db cannot reach audit_db. Plan
 * codes and prices are captured AT THE TIME rather than resolved on read, so a plan that is
 * re-priced or archived later cannot retroactively rewrite what a tenant was moved onto.
 *
 * <p>The pager is driven by `nextPage` from the response envelope, never by "did this page come
 * back full?" — a full final page would otherwise offer a next page that does not exist, which on a
 * trail reads as records being withheld.
 */
function SubscriptionHistory({ tenantId }: { tenantId: string }) {
  const [page, setPage] = React.useState(0);
  const history = useSubscriptionHistory(tenantId, page);
  const data = history.data;

  const columns = React.useMemo<ColumnDef<SubscriptionHistoryEntry, unknown>[]>(
    () => [
      {
        id: "change",
        header: "Change",
        accessorFn: (row) => row.changeType,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{operatorActionLabel(row.original.changeType)}</span>
            <span className="text-label text-foreground-tertiary">
              {formatDateTime(row.original.recordedAt)}
            </span>
          </span>
        ),
      },
      {
        id: "from-to",
        header: "Moved",
        accessorFn: (row) => row.toPlanCode ?? row.toTier ?? "",
        meta: { mono: true },
        cell: ({ row }) => {
          const from = row.original.fromPlanCode ?? row.original.fromTier;
          const to = row.original.toPlanCode ?? row.original.toTier;
          if (!from && !to) return <span className="text-foreground-tertiary">—</span>;
          return (
            <span>
              {from ?? "none"} <span aria-hidden="true">→</span> <span className="sr-only">to</span>
              {to ?? "none"}
            </span>
          );
        },
      },
      {
        id: "price",
        header: "List price",
        meta: { align: "end", hideBelow: "lg" },
        accessorFn: (row) => row.toPricePaisa ?? -1,
        cell: ({ row }) =>
          row.original.toPricePaisa === null ? (
            <span className="text-foreground-tertiary">Not recorded</span>
          ) : (
            <MoneyDisplay paisa={row.original.toPricePaisa} />
          ),
      },
      {
        id: "actor",
        header: "Applied by",
        accessorFn: (row) => row.actorEmail ?? row.actorKind,
        meta: { hideBelow: "md" },
        cell: ({ row }) =>
          row.original.actorEmail ? (
            <span>{row.original.actorEmail}</span>
          ) : (
            // SYSTEM is a true statement about a scheduler-applied change, and a deleted platform
            // account is a true statement about a person who is gone. Neither is a blank.
            <span className="text-foreground-tertiary">
              {row.original.actorKind === "SYSTEM" ? "Scheduler" : "Account no longer exists"}
            </span>
          ),
      },
      {
        id: "reason",
        header: "Reason",
        accessorFn: (row) => row.reason ?? "",
        meta: { hideBelow: "xl" },
        cell: ({ row }) =>
          row.original.reason ? (
            <span className="block max-w-[24rem] truncate">{row.original.reason}</span>
          ) : (
            <span className="text-foreground-tertiary">No reason recorded</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-(--space-sm)">
      <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
        Subscription history
      </p>
      <QueryBoundary
        query={history}
        what="this tenant's subscription history"
        loading={<Skeleton className="h-24" />}
        isEmpty={Boolean(data) && data!.entries.length === 0}
        empty={
          <ConsoleNote data-testid="subscription-history-empty">
            Nothing has moved this tenant&apos;s plan or tier since the trail began recording. This
            is an append-only record: an empty one means no transition happened, not that a
            transition was hidden.
          </ConsoleNote>
        }
      >
        {data ? (
          <div className="flex flex-col gap-(--space-sm)" data-testid="subscription-history">
            <DataGrid
              columns={columns}
              data={data.entries}
              density="comfortable"
              label="Subscription history"
              card={{
                primary: (row) => operatorActionLabel(row.changeType),
                secondary: (row) => formatDateTime(row.recordedAt),
                trailing: (row) => (
                  <span className="font-mono">{row.toPlanCode ?? row.toTier ?? "—"}</span>
                ),
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
              <p className="text-small text-foreground-secondary">
                {formatNumber(data.totalCount)} transition{data.totalCount === 1 ? "" : "s"}{" "}
                recorded
              </p>
              <div className="flex items-center gap-(--space-sm)">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  data-testid="subscription-history-prev"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.nextPage === null}
                  onClick={() => setPage(page + 1)}
                  data-testid="subscription-history-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

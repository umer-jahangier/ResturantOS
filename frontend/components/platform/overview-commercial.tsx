"use client";

import { CalendarClock, CircleSlash, Hourglass, ScrollText } from "lucide-react";

import { formatNumber } from "@/lib/format/locale";
import { CardEyebrow } from "@/components/ui/card";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { Meter } from "@/components/ui/meter";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { usePlatformSubscriptionRegister } from "@/lib/hooks/use-platform-overview";
import type { SubscriptionRegister } from "@/lib/models/platform-overview.model";

/**
 * The commercial surface — and the reason it is not a revenue strip.
 *
 * <h3>There is no billing in this product, so there is no revenue tile</h3>
 *
 * Verified exhaustively before this component was written: every `@Table` across sixteen services
 * enumerated, and a repository-wide search for `stripe|paddle|chargebee|razorpay|mrr|arr|plan_price`
 * returns five hits, all of them the string `billing_ref` — a free-text VARCHAR on the tenant row
 * with no foreign key and no schema. There is no invoice, no payment, no processor integration and
 * no ledger of platform-side money anywhere.
 *
 * <p>So MRR, ARR, ARPU, churn value and failed payments are not rendered as numbers, not as
 * zeroes, and not as placeholder charts. `SubscriptionRegisterResponse.revenueNote` states that
 * absence in the backend's own words and this component prints it verbatim, which is a stronger
 * guarantee than a comment: the sentence a reader sees comes from the service that would have to
 * compute the figure.
 *
 * <h3>What IS real, and is therefore what this card is made of</h3>
 *
 * Plans, subscription lifecycle, trials, scheduled changes, cancellations and plan ceilings are
 * all genuine rows in `platform_db`. Four counts, a plan mix and a list price per plan is a
 * smaller card than a revenue dashboard and every figure on it can be checked.
 *
 * <h3>Not one figure here reads the wall clock</h3>
 *
 * `TRIALING` / `TRIAL_ENDED` and `renewalOverdue` are the SERVER's derivations, computed against
 * the server's clock in the same request that read the rows. Re-deriving "expiring soon" in the
 * browser would put a second, differently-timed opinion on the same screen — and `TRIAL_ENDED` in
 * particular is a worklist state the scheduler owns, not something a client may infer.
 */

interface PlanBucket {
  planCode: string;
  planName: string;
  count: number;
  pricePaisa: number;
  currency: string;
  billingPeriod: string;
}

const PERIOD_LABEL: Record<string, string> = {
  MONTHLY: "per month",
  QUARTERLY: "per quarter",
  ANNUAL: "per year",
};

/**
 * Subscriptions grouped by the plan they name, biggest first.
 *
 * <p>The price shown is the one on the ROW, which the register resolved from the plan at read
 * time. It is what the plan is sold at. It is never summed, and there is deliberately no
 * "total contract value" line: a sum of list prices across tenants looks exactly like revenue and
 * is not, because nothing in this product observes whether any of it was paid.
 */
function bucketByPlan(register: SubscriptionRegister): PlanBucket[] {
  const buckets = new Map<string, PlanBucket>();
  for (const row of register.rows) {
    const existing = buckets.get(row.planCode);
    if (existing) {
      existing.count += 1;
      continue;
    }
    buckets.set(row.planCode, {
      planCode: row.planCode,
      planName: row.planName,
      count: 1,
      pricePaisa: row.pricePaisa,
      currency: row.currency,
      billingPeriod: row.billingPeriod,
    });
  }
  return [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.planCode.localeCompare(b.planCode),
  );
}

function CommercialTiles({ register }: { register: SubscriptionRegister }) {
  const trialing = register.rows.filter((row) => row.status === "TRIALING").length;
  const trialEnded = register.rows.filter((row) => row.status === "TRIAL_ENDED").length;
  const overdue = register.rows.filter((row) => row.renewalOverdue).length;

  return (
    <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Subscriptions"
        value={formatNumber(register.totalSubscriptions)}
        icon={ScrollText}
        accent="primary"
        surface="glass"
      />
      <StatTile
        label="In trial"
        value={formatNumber(trialing)}
        icon={Hourglass}
        accent="primary"
        surface="glass"
      />
      {/*
        `TRIAL_ENDED` changes no entitlement — it does not suspend a tenant, gate a feature or lower
        a ceiling. It is produced by the clock and it means "this needs a decision", which is why
        the label says so rather than saying "expired".
      */}
      <StatTile
        label="Trial ended, awaiting a decision"
        value={formatNumber(trialEnded)}
        icon={CalendarClock}
        surface="glass"
      />
      {/*
        The scheduler does NOT roll renewal periods forward. Advancing the date would assert that
        the tenant paid, and this product observes no payments — so a renewal is an operator action
        and this count is the worklist that prompts it.
      */}
      <StatTile
        label="Renewal overdue"
        value={formatNumber(overdue)}
        icon={CircleSlash}
        surface="glass"
      />
    </div>
  );
}

function PlanMix({ register }: { register: SubscriptionRegister }) {
  const buckets = bucketByPlan(register);

  if (buckets.length === 0) {
    return (
      <p className="text-small text-foreground-secondary">
        No tenant has been assigned a plan yet. Nothing was backfilled when the subscription
        registry was added, because inventing a plan, a price and a start date would assert an
        agreement nobody made.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-(--space-md)">
      <CardEyebrow>Plan mix</CardEyebrow>
      <div className="flex flex-col gap-(--space-md)">
        {buckets.map((bucket) => (
          <div key={bucket.planCode} className="flex flex-col gap-1">
            <Meter
              label={bucket.planName}
              value={bucket.count}
              of={register.totalSubscriptions}
              noun="tenants"
              size="sm"
            />
            <p className="flex flex-wrap items-baseline gap-1.5 text-label text-foreground-tertiary">
              <span className="font-mono tabular-nums">{bucket.planCode}</span>
              <span aria-hidden="true">·</span>
              <span>list price</span>
              {/* BIGINT paisa, through the one money renderer in the product. This is what the plan
                  is SOLD at — see `revenueNote` printed below the mix. */}
              <MoneyDisplay paisa={bucket.pricePaisa} currency={bucket.currency} />
              <span>{PERIOD_LABEL[bucket.billingPeriod] ?? bucket.billingPeriod}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewCommercial() {
  const register = usePlatformSubscriptionRegister();
  const data = register.data;

  return (
    <ConsoleSection
      anchorId="platform-commercial"
      eyebrow="Commercial"
      title="Plans and subscriptions"
      description="What each tenant is entitled to and what state that entitlement is in. There is no revenue figure on this console because this product records no payment."
    >
      <QueryBoundary
        query={register}
        what="the subscription register"
        moduleLabel="Platform"
        loading={
          <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-(--space-lg)">
            <CommercialTiles register={data} />

            {/*
              THE COVERAGE NUMBER. Without it the mix below reads as "the fleet" while silently
              omitting every tenant that has no subscription record — which, until an operator
              assigns plans, is all of them.
            */}
            {data.tenantsWithoutSubscription > 0 && (
              <p className="text-small text-foreground-secondary">
                <span className="font-semibold text-foreground">
                  {formatNumber(data.tenantsWithoutSubscription)} tenants have no subscription
                  record.
                </span>{" "}
                Their entitlements come from their tier, and they are not counted in anything below.
              </p>
            )}

            <PlanMix register={data} />

            {/*
              Printed VERBATIM from the response, through the console's shared "stated absence"
              device. The absence of billing is a fact about the system, and the service that would
              have to compute a revenue figure is the right author of the sentence saying it cannot.
            */}
            <ConsoleNote>{data.revenueNote}</ConsoleNote>
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

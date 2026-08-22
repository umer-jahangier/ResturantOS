"use client";

import * as React from "react";
import { Archive, CheckCircle2, Layers, ScrollText, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardEyebrow, CardHeader } from "@/components/ui/card";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatTile } from "@/components/ui/stat-tile";
import { ConsoleNote } from "@/components/platform/console-section";
import { TierBadge } from "@/components/platform/tenant-badges";
import { formatNumber } from "@/lib/format/locale";
import { usePlatformPlans } from "@/lib/hooks/use-platform-plans";
import {
  billingPeriodLabel,
  perPeriodLabel,
  type SubscriptionPlan,
  type TenantTier,
} from "@/lib/models/platform.model";

/**
 * The plan catalogue: what each plan is called, what it is sold at, and what it lets a tenant do.
 *
 * <h3>The price is a LIST PRICE and this screen never adds two of them together</h3>
 *
 * `pricePaisa` is BIGINT paisa and is rendered only through `MoneyDisplay`, always beside the
 * period it is charged for. It is never summed, never annualised, never multiplied by a
 * subscription count and never called revenue — because **this product contains no billing at
 * all**. Sixteen services were enumerated for it: there is no invoice table, no payment table, no
 * processor client and no webhook, and `billing_ref` is a free-text VARCHAR on the tenant row with
 * no foreign key. A "PKR 1.4M MRR" tile built from list price × subscriber count would be a
 * fabrication rendered in the product's own confident voice, on the screen where pricing decisions
 * are made, and an operator would act on it. The fourth tile states the absence instead.
 *
 * <h3>Four ceilings are enforced; two are only written down</h3>
 *
 * Branches, users, storage and the NLQ quota are measured against real usage by the limits report,
 * so a downgrade below them is refused. Terminals and monthly orders **cannot be measured from the
 * platform plane at all** — `pos_terminals` sits behind FORCE row-level security in pos_db with no
 * internal count endpoint, and monthly order volume lives in ClickHouse, which platform-admin
 * -service has no driver for. Rendering all six in one undifferentiated list would tell an operator
 * that six limits are being enforced when four are. They are shown in two groups, labelled.
 *
 * <h3>Features are a statement about the TIER, not about the plan</h3>
 *
 * The `features` map is DERIVED through `TierFeatureDefaults` rather than stored on the plan row —
 * there is one feature matrix in this product and a second copy would be wrong from the first time
 * a code changed tier. So two plans on the same tier grant identical modules however differently
 * they are priced, and the card says so rather than implying the plan carries its own entitlements.
 */
export function PlanCatalogue() {
  const [catalogue, setCatalogue] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [search, setSearch] = React.useState("");

  const includeInactive = catalogue === "all";
  const plans = usePlatformPlans(includeInactive);

  const all = React.useMemo(() => plans.data ?? [], [plans.data]);

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((plan) => {
      if (tier && plan.tier !== tier) return false;
      if (
        needle &&
        !plan.name.toLowerCase().includes(needle) &&
        !plan.code.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [all, tier, search]);

  const liveCount = React.useMemo(() => all.filter((plan) => plan.active).length, [all]);
  const subscribed = React.useMemo(
    () => all.reduce((total, plan) => total + plan.subscriptionCount, 0),
    [all],
  );

  const filtered = Boolean(tier || search.trim());
  const clearAll = React.useCallback(() => {
    setTier("");
    setSearch("");
  }, []);

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Plans in the catalogue"
          value={formatNumber(all.length)}
          icon={Layers}
          accent="primary"
        />
        <StatTile
          label="Available to assign"
          value={formatNumber(liveCount)}
          icon={CheckCircle2}
          accent="secondary"
        />
        {/*
          A count of subscriptions, which is a real number this endpoint returns per plan and which
          sums honestly. It is a COUNT and it is labelled as one — the moment it were multiplied by a
          price it would become a revenue claim, which is the line this screen does not cross.

          It also does not move when the Archived filter is switched, and that is a property of the
          data rather than a coincidence worth checking for: archiving is REFUSED while any
          subscription still names a plan (`PLAN_IN_USE`), and an archived plan cannot be newly
          assigned, so every archived plan carries exactly zero. The tile therefore reconciles
          against the fleet either way.
        */}
        <StatTile
          label="Subscriptions naming a plan"
          value={formatNumber(subscribed)}
          icon={ScrollText}
        />
        {/*
          The tile that refuses to make a number up, and the reason it is a tile rather than an
          omission: an operator opening a plan catalogue expects a commercial figure here, and being
          shown nothing at all leaves them assuming it failed to load. `StatTile`'s
          `unavailableReason` is a discriminated union — passing a value beside it does not compile —
          so this cannot quietly acquire a zero later.
        */}
        <StatTile
          label="Revenue from these plans"
          icon={Wallet}
          unavailableReason="Billing is not integrated. This product records no invoice, payment or processor transaction anywhere, so no revenue, MRR or ARR figure can be computed. The prices below are what each plan is sold at, not money received."
        />
      </div>

      <QueryBoundary
        query={plans}
        what="the plan catalogue"
        moduleLabel="Plans"
        loading={<DataTableSkeleton columns={6} />}
        isEmpty={all.length === 0}
        empty={
          <EmptyState
            icon={Layers}
            title={includeInactive ? "No plans exist yet" : "No live plans"}
            description={
              includeInactive
                ? "Nothing has been added to the catalogue. Until a plan exists, every tenant's entitlement comes from its tier alone."
                : "Every plan in the catalogue is archived. Archived plans stay readable so historical prices survive, but none can be assigned to a tenant."
            }
          />
        }
      >
        <div className="flex flex-col gap-(--space-md)">
          <FilterBar
            title="Catalogue"
            search={{
              value: search,
              onChange: setSearch,
              label: "Search plans by name or code",
              placeholder: "Name or code…",
            }}
            filters={[
              {
                id: "tier",
                label: "Tier",
                value: tier,
                onChange: setTier,
                options: TIER_OPTIONS,
                allLabel: "Any tier",
                testId: "plan-filter-tier",
              },
              {
                id: "catalogue",
                label: "Archived",
                value: catalogue,
                onChange: setCatalogue,
                options: CATALOGUE_OPTIONS,
                allLabel: "Live plans only",
                testId: "plan-filter-catalogue",
              },
            ]}
            onClearAll={clearAll}
          />

          <p className="text-small text-foreground-secondary" data-testid="plan-catalogue-count">
            <span className="font-medium text-foreground">
              {formatNumber(all.length)} plan{all.length === 1 ? "" : "s"}
            </span>
            {includeInactive
              ? ", archived ones included. An archived plan cannot be newly assigned — the API refuses it — but it stays in the catalogue so the price a tenant was moved onto still resolves in the history."
              : ". Archived plans are hidden; switch the Archived filter to see them."}{" "}
            {filtered ? (
              <span className={cn("font-medium", rows.length === 0 && "text-warning")}>
                Filters show {formatNumber(rows.length)} of them.
              </span>
            ) : (
              <span>All of them are shown below.</span>
            )}
          </p>

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing matches these filters."
              description="Try widening or clearing them to see more plans."
              action={{ label: "Clear all", onClick: clearAll }}
            />
          ) : (
            <div
              className="grid grid-cols-1 gap-(--space-md) lg:grid-cols-2 2xl:grid-cols-3"
              data-testid="plan-cards"
            >
              {rows.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          )}

          <PlanComparison plans={rows} isFiltered={filtered} onClearFilters={clearAll} />
        </div>
      </QueryBoundary>
    </div>
  );
}

const TIER_OPTIONS: ReadonlyArray<{ value: TenantTier; label: string }> = [
  { value: "STARTER", label: "Starter" },
  { value: "GROWTH", label: "Growth" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "CUSTOM", label: "Custom" },
];

/**
 * Archived plans are a different LIST, not a narrowing of this one — `includeInactive` is a server
 * parameter and the API answers with more rows, not fewer. It is offered as a filter anyway because
 * that is where an operator looks for it, and the count sentence states which list they are on.
 */
const CATALOGUE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "Include archived" },
];

/** One plan, as an operator reads it before deciding to put a restaurant on it. */
function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  const enabledFeatures = React.useMemo(
    () =>
      Object.entries(plan.features)
        .filter(([, enabled]) => enabled)
        .map(([code]) => code)
        .sort(),
    [plan.features],
  );

  return (
    <Card depth={1} data-testid={`plan-card-${plan.code}`} className="h-full">
      <CardHeader className="border-b">
        <CardEyebrow className="tracking-eyebrow">{plan.code}</CardEyebrow>
        <div className="flex flex-wrap items-start justify-between gap-(--space-sm)">
          <h3 className="font-heading text-h2 leading-snug font-medium">{plan.name}</h3>
          <span className="flex flex-wrap items-center gap-(--space-xs)">
            <TierBadge tier={plan.tier} />
            {plan.active ? null : (
              <span
                data-testid={`plan-archived-${plan.code}`}
                className="inline-flex items-center gap-1 rounded-full border border-border border-dashed bg-muted px-2 py-0.5 text-label font-semibold whitespace-nowrap text-muted-foreground"
              >
                <Archive className="size-3.5 shrink-0" aria-hidden="true" />
                Archived
              </span>
            )}
          </span>
        </div>
        {plan.description ? (
          <p className="text-small text-muted-foreground">{plan.description}</p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-(--space-md)">
        {/*
          The price, in the display serif, with its period beside it. The period is not decoration:
          `Rs 25,000` means three different things at MONTHLY, QUARTERLY and ANNUAL, and a plan
          catalogue that omitted it would have operators comparing numbers that are not comparable.
        */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-display leading-none font-semibold tabular-nums">
            <MoneyDisplay paisa={plan.pricePaisa} currency={plan.currency} />
          </span>
          <span className="text-small text-foreground-tertiary">
            {perPeriodLabel(plan.billingPeriod)}
          </span>
        </div>
        <p className="text-label text-foreground-tertiary">
          List price — what this plan is sold at. Nothing in this product records what was received.
        </p>

        <dl className="grid grid-cols-2 gap-(--space-sm)">
          <PlanFigure label="Billing period" value={billingPeriodLabel(plan.billingPeriod)} />
          <PlanFigure
            label="Trial"
            value={
              plan.trialDays > 0 ? `${formatNumber(plan.trialDays)} days` : "No trial on this plan"
            }
            muted={plan.trialDays === 0}
          />
          <PlanFigure
            label="Tenants on this plan"
            value={formatNumber(plan.subscriptionCount)}
            mono
          />
          <PlanFigure label="Entitlement tier" value={plan.tier} mono />
        </dl>

        <section className="flex flex-col gap-(--space-sm)">
          <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
            Enforced ceilings
          </p>
          <dl className="grid grid-cols-2 gap-(--space-sm)">
            <PlanFigure label="Branches" value={ceilingText(plan.maxBranches)} mono />
            <PlanFigure label="Users" value={ceilingText(plan.maxUsers)} mono />
            <PlanFigure label="Storage" value={ceilingText(plan.storageGb, "GB")} mono />
            <PlanFigure label="NLQ queries" value={ceilingText(plan.nlqQuota)} mono />
          </dl>
        </section>

        {/*
          The two ceilings nothing checks. Kept on the card — an operator negotiating a plan needs to
          see what was written down — but ruled off and labelled, because a console that listed all
          six together would be claiming six enforcements where there are four.
        */}
        <section className="flex flex-col gap-(--space-sm) border-t border-dashed border-border pt-(--space-sm)">
          <p className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
            Declared, not measured
          </p>
          <dl className="grid grid-cols-2 gap-(--space-sm)">
            <PlanFigure
              label="POS terminals"
              value={plan.maxTerminals === null ? "No ceiling set" : ceilingText(plan.maxTerminals)}
              muted={plan.maxTerminals === null}
              mono={plan.maxTerminals !== null}
            />
            <PlanFigure
              label="Orders per month"
              value={
                plan.maxOrdersPerMonth === null
                  ? "No ceiling set"
                  : ceilingText(plan.maxOrdersPerMonth)
              }
              muted={plan.maxOrdersPerMonth === null}
              mono={plan.maxOrdersPerMonth !== null}
            />
          </dl>
          <p className="text-label text-foreground-tertiary">
            Terminals live behind row-level security in the POS database and monthly order volume
            lives in ClickHouse, neither of which the platform plane can read. These two are what
            was agreed, not something a limit check enforces.
          </p>
        </section>

        <section className="flex flex-col gap-(--space-sm)">
          <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
            Modules granted
          </p>
          {enabledFeatures.length === 0 ? (
            <p className="text-small text-foreground-tertiary">
              This tier grants no modules by default. A tenant can still hold operator overrides,
              which are set per tenant and outrank the tier.
            </p>
          ) : (
            <ul
              className="flex flex-wrap gap-(--space-xs)"
              data-testid={`plan-features-${plan.code}`}
            >
              {enabledFeatures.map((code) => (
                <li
                  key={code}
                  className="rounded-full border border-border bg-decorative px-2 py-0.5 font-mono text-label text-foreground-secondary"
                >
                  {code}
                </li>
              ))}
            </ul>
          )}
          <p className="text-label text-foreground-tertiary">
            Derived from the {plan.tier} tier, not stored on the plan — every plan on this tier
            grants exactly these. A tenant&apos;s own overrides are set on its modules panel.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

/** A labelled figure inside a plan card. `—` never appears bare; an absence is words. */
function PlanFigure({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-small",
          muted ? "text-foreground-tertiary" : "font-medium text-foreground",
          mono && !muted && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A ceiling.
 *
 * `0` is rendered as "None allowed" rather than as a bare zero, because on this table zero is a
 * real, deliberate value — the database constraint permits it and it means the plan grants none of
 * that resource — and a lone `0` in a column of ceilings reads as a missing figure.
 */
function ceilingText(value: number, unit?: string): string {
  if (value === 0) return "None allowed";
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

/**
 * The plans side by side.
 *
 * <h3>Why a grid as well as the cards</h3>
 *
 * The cards answer "what is this plan?". They cannot answer "which of these is bigger?", because
 * comparing a figure across five cards means reading five cards. The grid puts every ceiling in a
 * mono column with tabular figures, which is what makes a column of numbers scannable for
 * magnitude rather than readable one at a time.
 *
 * <p>The two unmeasurable ceilings are deliberately absent from this grid. On a card they can be
 * ruled off and captioned; in a comparison column they would sit beside four enforced ones with
 * nothing to distinguish them, and an operator scanning for "what does this plan cap?" would take
 * all six as caps.
 */
function PlanComparison({
  plans,
  isFiltered,
  onClearFilters,
}: {
  plans: SubscriptionPlan[];
  isFiltered: boolean;
  onClearFilters: () => void;
}) {
  const columns = React.useMemo<ColumnDef<SubscriptionPlan, unknown>[]>(
    () => [
      {
        id: "plan",
        header: "Plan",
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <span className="block max-w-[18rem] py-1.5">
            <span className="block truncate font-medium text-foreground">{row.original.name}</span>
            <span className="block truncate font-mono text-label text-foreground-tertiary">
              {row.original.code}
              {row.original.active ? "" : " · archived"}
            </span>
          </span>
        ),
      },
      {
        id: "tier",
        header: "Tier",
        accessorFn: (row) => row.tier,
        cell: ({ row }) => <TierBadge tier={row.original.tier} />,
      },
      {
        id: "price",
        header: "List price",
        accessorFn: (row) => row.pricePaisa,
        meta: { mono: true, align: "end" },
        cell: ({ row }) => (
          <span className="flex flex-col items-end">
            <MoneyDisplay paisa={row.original.pricePaisa} currency={row.original.currency} />
            <span className="text-label font-normal text-foreground-tertiary">
              {perPeriodLabel(row.original.billingPeriod)}
            </span>
          </span>
        ),
      },
      {
        id: "trial",
        header: "Trial",
        accessorFn: (row) => row.trialDays,
        meta: { mono: true, align: "end", hideBelow: "md" },
        cell: ({ row }) =>
          row.original.trialDays > 0 ? (
            <span>{formatNumber(row.original.trialDays)}d</span>
          ) : (
            <span className="font-sans text-foreground-tertiary">None</span>
          ),
      },
      {
        id: "branches",
        header: "Branch ceiling",
        accessorFn: (row) => row.maxBranches,
        meta: { mono: true, align: "end", hideBelow: "lg" },
        cell: ({ row }) => ceilingText(row.original.maxBranches),
      },
      {
        id: "users",
        header: "User ceiling",
        accessorFn: (row) => row.maxUsers,
        meta: { mono: true, align: "end", hideBelow: "lg" },
        cell: ({ row }) => ceilingText(row.original.maxUsers),
      },
      {
        id: "storage",
        header: "Storage",
        accessorFn: (row) => row.storageGb,
        meta: { mono: true, align: "end", hideBelow: "xl" },
        cell: ({ row }) => ceilingText(row.original.storageGb, "GB"),
      },
      {
        id: "nlq",
        header: "NLQ quota",
        accessorFn: (row) => row.nlqQuota,
        meta: { mono: true, align: "end", hideBelow: "xl" },
        cell: ({ row }) => ceilingText(row.original.nlqQuota),
      },
      {
        id: "tenants",
        header: "Tenants",
        accessorFn: (row) => row.subscriptionCount,
        meta: { mono: true, align: "end", hideBelow: "md" },
        cell: ({ row }) => formatNumber(row.original.subscriptionCount),
      },
    ],
    [],
  );

  return (
    <section className="flex flex-col gap-(--space-sm)" data-testid="plan-comparison">
      <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
        Ceilings side by side
      </p>
      <DataGrid
        columns={columns}
        data={plans}
        label="Plan ceilings compared"
        getRowId={(row) => row.id}
        isFiltered={isFiltered}
        onClearFilters={onClearFilters}
        emptyTitle="No plans to compare"
        emptyDescription="A plan has to exist in the catalogue before its ceilings can be compared."
        card={{
          primary: (row) => row.name,
          secondary: (row) => <span className="font-mono">{row.code}</span>,
          trailing: (row) => <MoneyDisplay paisa={row.pricePaisa} currency={row.currency} />,
        }}
      />
      <ConsoleNote data-testid="plan-comparison-note">
        Only the four ceilings above are checked against real usage. A plan&apos;s terminal and
        monthly-order limits are recorded but unmeasurable from the platform plane, so they are on
        each plan&apos;s card rather than in this comparison — a column of six would imply six
        enforcements where there are four.
      </ConsoleNote>
    </section>
  );
}

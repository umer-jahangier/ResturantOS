"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Building2, ScrollText, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { MoneyDisplay } from "@/components/ui/money-display";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatTile } from "@/components/ui/stat-tile";
import { ConsoleNote } from "@/components/platform/console-section";
import { SubscriptionStatusBadge } from "@/components/platform/subscription-badges";
import { TierBadge } from "@/components/platform/tenant-badges";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { usePlatformPlans } from "@/lib/hooks/use-platform-plans";
import { REGISTER_PAGE_SIZE, useSubscriptionRegister } from "@/lib/hooks/use-platform-subscription";
import {
  perPeriodLabel,
  subscriptionStatusLabel,
  type SubscriptionRegisterRow,
  type SubscriptionStatus,
} from "@/lib/models/platform.model";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * The cross-tenant register: every subscription, and the tenants that have none.
 *
 * <h3>This screen is the honest replacement for a revenue dashboard</h3>
 *
 * There is no MRR tile, no ARR tile, no invoice column, no payment status, no failed-payment list
 * and no churn value — **not as a number, not as a zero, and not as an empty chart.** This product
 * contains no billing integration and no payment entity: sixteen services were enumerated for one,
 * and the only string resembling billing anywhere is `billing_ref`, a free-text VARCHAR with no
 * foreign key. What a control plane actually needs from a commercial register is which trials are
 * about to lapse, which renewals nobody has confirmed, which changes are scheduled and which
 * cancellations are booked — all of which are real records here — so those are what it shows.
 *
 * <h3>`renewalOverdue` means "an operator should look", not "the tenant did not pay"</h3>
 *
 * It is DERIVED, on every read, from a period end that has passed while the subscription is still
 * live. The scheduler deliberately never rolls that date forward, and the backend's own sweep test
 * pins that behaviour — because advancing the date would assert a payment, and nothing in this
 * product observes one. So a renewal is an operator ASSERTION, made on the tenant's own screen, and
 * this column is the worklist that prompts it. Every label on this screen says so in those words;
 * calling it "overdue payment" would turn a clock reading into an accusation.
 *
 * <h3>The coverage figure is not optional</h3>
 *
 * The register lists subscriptions. It cannot list a tenant that has none — and until an operator
 * assigns plans, that is every tenant, because nothing was backfilled when the registry shipped
 * (inventing a plan, a price and a start date for an existing tenant would assert an agreement
 * nobody made). Rendering the rows alone would imply the missing tenants do not exist, so
 * `tenantsWithoutSubscription` rides in the response and is on the screen as a tile AND, when it is
 * non-zero, as a banner pointing at the tenant register where those tenants can be found.
 */
export function SubscriptionRegisterView() {
  const [status, setStatus] = React.useState("");
  const [planCode, setPlanCode] = React.useState("");
  const [attention, setAttention] = React.useState("");
  const [page, setPage] = React.useState(0);

  /*
   * The clock is read ONCE, at mount, through a lazy `useState` initialiser.
   *
   * Two separate reasons, and both are load-bearing. `Date.now()` in a component body is an impure
   * render that the React compiler rejects outright — two components reading the clock in one render
   * can disagree and neither ever updates. And a moving `now` would be worse than impure here: it is
   * part of the query key, so a fresh millisecond on every render would mint a new cache entry and
   * refetch the register forever. An operator's session is short enough that a boundary fixed when
   * the screen opened is the same boundary re-opening it would give them.
   */
  const [openedAt] = React.useState(() => Date.now());
  const attentionWindow = React.useMemo(() => {
    if (attention === "trials-ending") {
      return { trialEndingBefore: new Date(openedAt + TRIAL_HORIZON_MS).toISOString() };
    }
    if (attention === "renewal-passed") {
      return { renewingBefore: new Date(openedAt).toISOString() };
    }
    return {};
  }, [attention, openedAt]);

  const register = useSubscriptionRegister({
    status: status || undefined,
    planCode: planCode || undefined,
    ...attentionWindow,
    page,
  });
  /*
   * Archived plans included, because a tenant can still BE on one and this is the screen where you
   * would go looking for them. A filter that silently cannot name a closed plan answers "no
   * subscriptions" to a question that has an answer.
   */
  const plans = usePlatformPlans(true);
  const data = register.data;

  const planOptions = React.useMemo(
    () =>
      (plans.data ?? []).map((plan) => ({
        value: plan.code,
        label: plan.active ? plan.name : `${plan.name} — archived`,
      })),
    [plans.data],
  );

  const filtered = Boolean(status || planCode || attention);
  const clearAll = React.useCallback(() => {
    setStatus("");
    setPlanCode("");
    setAttention("");
    setPage(0);
  }, []);

  // Any filter change resets to the first page. Staying on page 3 of a narrower result set shows an
  // empty grid for a filter that matched rows, which reads as "nothing found".
  const onFilter = React.useCallback((apply: () => void) => {
    apply();
    setPage(0);
  }, []);

  const columns = React.useMemo<ColumnDef<SubscriptionRegisterRow, unknown>[]>(
    () => [
      {
        id: "tenant",
        header: "Tenant",
        accessorFn: (row) => row.tenantBrandName ?? row.tenantId,
        cell: ({ row }) => (
          <span className="block max-w-[20rem] py-1.5">
            <Link
              href={`/platform/subscriptions/${row.original.tenantId}`}
              data-testid={`subscription-row-${row.original.tenantSlug ?? row.original.tenantId}`}
              className="block truncate font-medium text-foreground hover:text-primary"
            >
              {/*
                A tenant row that could not be resolved is NAMED as unresolvable rather than left
                blank. The subscription exists and points at a tenant id; showing an empty cell would
                make it look like a rendering fault instead of a data one worth chasing.
              */}
              {row.original.tenantBrandName ?? "Tenant record not found"}
            </Link>
            <span className="block truncate font-mono text-label text-foreground-tertiary">
              {row.original.tenantSlug ?? row.original.tenantId.slice(0, 8)}
            </span>
          </span>
        ),
      },
      {
        id: "plan",
        header: "Plan",
        accessorFn: (row) => row.planCode ?? "",
        cell: ({ row }) =>
          row.original.planCode === null ? (
            <span className="text-foreground-tertiary">Plan record not found</span>
          ) : (
            <span className="block max-w-[14rem]">
              <span className="block truncate">
                {row.original.planName ?? row.original.planCode}
              </span>
              <span className="block truncate font-mono text-label text-foreground-tertiary">
                {row.original.planCode}
              </span>
            </span>
          ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => <SubscriptionStatusBadge status={row.original.status} />,
      },
      {
        id: "tier",
        header: "Tier",
        accessorFn: (row) => row.tier ?? "",
        meta: { hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.tier === null ? (
            <span className="text-foreground-tertiary">Unknown</span>
          ) : (
            <TierBadge tier={row.original.tier} />
          ),
      },
      {
        id: "trial",
        header: "Trial ends",
        accessorFn: (row) => row.trialEndAt?.getTime() ?? 0,
        meta: { hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.trialEndAt === null ? (
            <span className="text-foreground-tertiary">Not on trial</span>
          ) : (
            <span className="whitespace-nowrap">
              {formatDateTime(row.original.trialEndAt, DATE_ONLY)}
            </span>
          ),
      },
      {
        id: "renewal",
        // "Period ends", not "Next payment": nothing here is a payment date, and a column headed
        // with the word would make the flag beneath it read as a failed charge.
        header: "Period ends",
        accessorFn: (row) => row.currentPeriodEndAt?.getTime() ?? 0,
        cell: ({ row }) =>
          row.original.currentPeriodEndAt === null ? (
            <span className="text-foreground-tertiary">No period recorded</span>
          ) : (
            <span className="flex flex-col">
              <span className="whitespace-nowrap">
                {formatDateTime(row.original.currentPeriodEndAt, DATE_ONLY)}
              </span>
              {row.original.renewalOverdue && (
                <span
                  className="text-label font-semibold text-warning"
                  data-testid={`renewal-passed-${row.original.tenantId}`}
                >
                  Date passed — needs a look
                </span>
              )}
            </span>
          ),
      },
      {
        id: "scheduled",
        header: "Scheduled",
        accessorFn: (row) => row.pendingChangeAt?.getTime() ?? row.cancelAt?.getTime() ?? 0,
        meta: { hideBelow: "xl" },
        cell: ({ row }) => <ScheduledCell row={row.original} />,
      },
      {
        id: "price",
        header: "List price",
        accessorFn: (row) => row.pricePaisa,
        meta: { mono: true, align: "end", hideBelow: "md" },
        cell: ({ row }) =>
          row.original.planCode === null ? (
            // NOT `Rs 0.00`. The API sends 0 when the plan row could not be resolved, and rendering
            // that as a price would be the console stating a figure the system does not have.
            <span className="font-sans text-foreground-tertiary">Unknown</span>
          ) : (
            <span className="flex flex-col items-end">
              <MoneyDisplay
                paisa={row.original.pricePaisa}
                currency={row.original.currency ?? undefined}
              />
              <span className="text-label font-normal text-foreground-tertiary">
                {perPeriodLabel(row.original.billingPeriod)}
              </span>
            </span>
          ),
      },
    ],
    [],
  );

  const rows = data?.rows ?? [];
  const firstIndex = page * REGISTER_PAGE_SIZE;
  const hasNext = data ? firstIndex + rows.length < data.totalSubscriptions : false;

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Subscriptions on record"
          value={data ? formatNumber(data.totalSubscriptions) : "—"}
          icon={ScrollText}
          accent="primary"
        />
        {/*
          The coverage tile. It is second, not last, because on the day the registry shipped it was
          the whole fleet — and a register that omits most of the platform while looking complete is
          the single most misleading thing this screen could do.
        */}
        <StatTile
          label="Tenants with no subscription"
          value={data ? formatNumber(data.tenantsWithoutSubscription) : "—"}
          icon={Building2}
          drillTo="/platform/tenants"
          drillLabel="Open the tenant register"
        />
        <StatTile
          label="Rows needing a look"
          value={formatNumber(rows.filter((row) => row.renewalOverdue).length)}
          icon={AlertTriangle}
        />
        {/*
          The absence, stated. `revenueNote` is the backend's own sentence and is rendered verbatim
          when it arrives — it exists in exactly one place server-side precisely so a screen can show
          the absence rather than quietly inventing an MRR tile to fill the slot.
        */}
        <StatTile
          label="Recurring revenue"
          icon={Wallet}
          unavailableReason={data?.revenueNote ?? REVENUE_ABSENT}
        />
      </div>

      {data && data.tenantsWithoutSubscription > 0 && (
        <ConsoleNote tone="warning" data-testid="subscription-coverage">
          {formatNumber(data.tenantsWithoutSubscription)} tenant
          {data.tenantsWithoutSubscription === 1 ? " has" : "s have"} no subscription record and{" "}
          {data.tenantsWithoutSubscription === 1 ? "does" : "do"} not appear below. That is not a
          fault: nothing was backfilled when this registry was added, because inventing a plan, a
          price and a start date for an existing tenant would assert an agreement nobody made. Those
          tenants still have a tier, and the tier is what the gateway enforces.{" "}
          <Link href="/platform/tenants" className="font-medium underline underline-offset-4">
            Open the tenant register
          </Link>{" "}
          to find them.
        </ConsoleNote>
      )}

      <QueryBoundary
        query={register}
        what="the subscription register"
        moduleLabel="Subscriptions"
        loading={<DataTableSkeleton columns={6} />}
        isEmpty={Boolean(data) && rows.length === 0 && !filtered && page === 0}
        empty={
          <EmptyState
            icon={ScrollText}
            title="No subscriptions yet"
            description="No tenant has been given a plan. Every tenant's entitlement still comes from its tier, which is what the gateway enforces — a subscription is the commercial record laid beside it, not the thing that gates a till."
          />
        }
      >
        <div className="flex flex-col gap-(--space-md)">
          <FilterBar
            title="Filters"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: (value) => onFilter(() => setStatus(value)),
                options: STATUS_OPTIONS,
                allLabel: "Any status",
                testId: "subscription-filter-status",
              },
              {
                id: "plan",
                label: "Plan",
                value: planCode,
                onChange: (value) => onFilter(() => setPlanCode(value)),
                options: planOptions,
                allLabel: "Any plan",
                isLoading: plans.isPending,
                error: plans.isError,
                onRetry: () => void plans.refetch(),
                testId: "subscription-filter-plan",
              },
              {
                id: "attention",
                label: "Needs attention",
                value: attention,
                onChange: (value) => onFilter(() => setAttention(value)),
                options: ATTENTION_OPTIONS,
                allLabel: "Everything",
                testId: "subscription-filter-attention",
              },
            ]}
            onClearAll={clearAll}
          />

          <p
            className="text-small text-foreground-secondary"
            data-testid="subscription-register-count"
          >
            {data ? (
              <>
                <span className="font-medium text-foreground">
                  {formatNumber(data.totalSubscriptions)} subscription
                  {data.totalSubscriptions === 1 ? "" : "s"}
                </span>{" "}
                match{data.totalSubscriptions === 1 ? "es" : ""} these filters
                {rows.length > 0 ? (
                  <>
                    , showing {formatNumber(firstIndex + 1)}–
                    {formatNumber(firstIndex + rows.length)}
                  </>
                ) : null}
                .{" "}
                <span className={cn(rows.length === 0 && filtered && "font-medium text-warning")}>
                  {rows.length === 0
                    ? "Nothing on this page — widen the filters or go back a page."
                    : "Filtering and paging both happen on the server, so this count is the whole match, not just this page."}
                </span>
              </>
            ) : null}
          </p>

          <div data-testid="subscription-table">
            <DataGrid
              columns={columns}
              data={rows}
              label="Tenant subscriptions"
              getRowId={(row) => row.tenantId}
              pageSize={REGISTER_PAGE_SIZE}
              isFiltered={filtered}
              onClearFilters={clearAll}
              emptyTitle="No subscriptions yet"
              emptyDescription="No tenant has been given a plan."
              card={{
                primary: (row) => (
                  <Link
                    href={`/platform/subscriptions/${row.tenantId}`}
                    data-testid={`subscription-card-${row.tenantSlug ?? row.tenantId}`}
                    className="font-medium"
                  >
                    {row.tenantBrandName ?? "Tenant record not found"}
                  </Link>
                ),
                secondary: (row) => (
                  <span className="font-mono">{row.planCode ?? "no plan resolved"}</span>
                ),
                trailing: (row) => (
                  <span className="flex flex-col items-end gap-1">
                    <SubscriptionStatusBadge status={row.status} />
                    {row.renewalOverdue && (
                      <span className="text-label font-semibold text-warning">
                        Period end passed
                      </span>
                    )}
                  </span>
                ),
              }}
            />
          </div>

          {/*
            The server pager. `DataGrid` paginates the array it is handed and its own pager hides
            when one page holds everything — which is why the grid's page size is the SAME constant
            as the server page. Two pagers disagreeing about what page you are on is the failure this
            avoids.
          */}
          <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
            <p className="text-small text-foreground-secondary">
              Page {formatNumber(page + 1)}
              {data && data.totalSubscriptions > 0
                ? ` of ${formatNumber(Math.max(1, Math.ceil(data.totalSubscriptions / REGISTER_PAGE_SIZE)))}`
                : ""}
            </p>
            <div className="flex items-center gap-(--space-sm)">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                data-testid="subscription-register-prev"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage(page + 1)}
                data-testid="subscription-register-next"
              >
                Next
              </Button>
            </div>
          </div>

          <ConsoleNote data-testid="subscription-register-note">
            A period end in the past means{" "}
            <span className="font-medium">an operator should look</span> — it does not mean a tenant
            failed to pay. Nothing in this product observes a payment, so the scheduler never rolls
            a renewal period forward: advancing that date would assert a payment nobody recorded. A
            renewal is stated by a person, on the tenant&apos;s own subscription screen, and the
            trail names who stated it.
          </ConsoleNote>
        </div>
      </QueryBoundary>
    </div>
  );
}

/** Fourteen days — the window in which "this trial is about to lapse" is still actionable. */
const TRIAL_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

/** The fallback wording if the API ever stops sending its own. Same claim, same words. */
const REVENUE_ABSENT =
  "Billing is not integrated: this product records no invoice, payment or processor transaction anywhere, so no revenue, MRR, ARR or churn-value figure can be computed. Plan prices are what each plan is sold at, not money received.";

const STATUS_OPTIONS: ReadonlyArray<{ value: SubscriptionStatus; label: string }> = (
  ["TRIALING", "ACTIVE", "TRIAL_ENDED", "CANCELLED", "ENDED"] as const
).map((value) => ({ value, label: subscriptionStatusLabel(value) }));

/**
 * The two questions this register is actually opened to answer, in the words an operator uses.
 *
 * Both are server-side date filters over a stored instant, and both are the CLOCK talking. Neither
 * is a payment fact, and the labels are written so that they cannot be read as one.
 */
const ATTENTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "trials-ending", label: "Trial ends within 14 days" },
  { value: "renewal-passed", label: "Period end has passed" },
];

/** What is booked to happen, and when. Two independent things, so both are rendered. */
function ScheduledCell({ row }: { row: SubscriptionRegisterRow }) {
  const hasChange = row.pendingPlanCode !== null && row.pendingChangeAt !== null;
  const hasCancellation = row.cancelAt !== null;

  if (!hasChange && !hasCancellation) {
    return <span className="text-foreground-tertiary">Nothing scheduled</span>;
  }

  return (
    <span className="flex flex-col gap-0.5">
      {hasChange && (
        <span className="whitespace-nowrap">
          <span className="font-mono">{row.pendingPlanCode}</span>{" "}
          <span className="text-foreground-tertiary">
            on {formatDateTime(row.pendingChangeAt, DATE_ONLY)}
          </span>
        </span>
      )}
      {hasCancellation && (
        <span className="whitespace-nowrap text-warning">
          Cancels {formatDateTime(row.cancelAt, DATE_ONLY)}
        </span>
      )}
    </span>
  );
}

"use client";

import * as React from "react";
import {
  Activity,
  CircleHelp,
  Database,
  Eye,
  RefreshCw,
  Server,
  ShieldQuestion,
  Zap,
} from "lucide-react";

import { formatElapsedLong } from "@/lib/format/elapsed";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { Button } from "@/components/ui/button";
import { ConsoleFact, ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { HealthBadge, HEALTH_STATE_MEANING } from "@/components/platform/health-badge";
import { InsetRow } from "@/components/ui/inset-row";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { usePlatformSystemHealth } from "@/lib/hooks/use-platform-overview";
import type {
  ComponentHealth,
  HealthState,
  MigrationState,
  ServiceHealth,
  SystemHealth,
  UncollectedMetric,
} from "@/lib/models/platform-overview.model";

/**
 * The full system status screen: every probe the platform can make, and every one it cannot.
 *
 * <h3>The rule, and the only rule</h3>
 *
 * **Anything this console cannot truthfully determine renders as UNKNOWN, and never as green.** A
 * status page that shows green because it failed to ask is worse than no status page: it converts
 * an absence of information into a reassurance, and it does so at exactly the moment somebody is
 * relying on it. So there is no default-healthy path anywhere below — no `?? "UP"`, no state
 * collapsed into a boolean, and no summary arithmetic that can produce green out of ignorance.
 *
 * <p>The backend holds the same line (`SystemHealthDtos`: "there is no default-healthy path
 * anywhere in this contract") and computes `overall` as UP only when every determinable component
 * is UP and nothing is indeterminate. This screen renders that value rather than recomputing one,
 * because two places deciding what "healthy" means is two places for one of them to be generous.
 *
 * <h3>How this differs from the dashboard's `OverviewSystem` card, and why both exist</h3>
 *
 * They read the SAME hook and the SAME cache — there is one request behind both. The card answers
 * "is anything wrong right now" in six rows on a landing page. This screen answers "what exactly,
 * on which instance, probed at which URI, in how many milliseconds, and how was that established"
 * — the per-instance detail, the probe URIs, the response times and the migration BASIS, none of
 * which fit a summary card and all of which are what an operator needs once the answer to the
 * first question is "yes". The badge mapping is imported from one module by both, so the two
 * surfaces cannot disagree about what UNKNOWN looks like.
 *
 * <h3>Why the query FAILING is not an outage report</h3>
 *
 * `GET /platform/system/health` returns 200 even when the fleet is on fire — the failures are IN
 * the document, deliberately, because a status endpoint that 503s when a dependency is down cannot
 * tell you which one. So an HTTP error from this call means the console could not reach the
 * CONTROL PLANE at all, which is a different and larger fact than "a service is down". It renders
 * through `QueryBoundary`'s failure state and never as a page of red tiles, because a page of red
 * tiles would be this console asserting fourteen outages it did not observe.
 */

/** The name `SystemHealthService` gives the reporting-service precondition. See `ClickHousePrecondition`. */
const CLICKHOUSE_MIGRATION = "clickhouse.analytics_fact_tables";

/** Response times are milliseconds, not elapsed-since — a number, through the pinned formatter. */
function responseTime(ms: number | null): string {
  return ms === null ? "No response" : `${formatNumber(ms)} ms`;
}

/**
 * The summary strip.
 *
 * <h3>Why "not determinable" is its own tile</h3>
 *
 * Because the alternative is to fold UNREACHABLE and UNKNOWN into "down", and those are the two
 * states this whole contract exists to keep separate. A tile reading "2 down" when the truth is
 * "2 nobody could reach" sends an operator to restart a healthy process; a tile reading "12 up"
 * out of fourteen services quietly implies the other two are the opposite of up. Four counts,
 * four meanings, and the deltas are absent because this system stores no prior snapshot of its own
 * health to compare against — a percentage change here would be `StatTile`'s D-38-16 defect one
 * level up: not a fabricated value, but a fabricated CHANGE in a value.
 */
function SummaryTiles({ health }: { health: SystemHealth }) {
  const counts = health.services.reduce(
    (acc, service) => {
      acc[service.state] += 1;
      return acc;
    },
    { UP: 0, DOWN: 0, UNREACHABLE: 0, UNKNOWN: 0 } as Record<HealthState, number>,
  );
  const indeterminate = counts.UNREACHABLE + counts.UNKNOWN;

  return (
    <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Services registered"
        value={formatNumber(health.services.length)}
        icon={Server}
        accent="primary"
        surface="glass"
      />
      <StatTile
        label="Answered, and healthy"
        value={formatNumber(counts.UP)}
        icon={Activity}
        accent="primary"
        surface="glass"
      />
      <StatTile
        label="Answered, and unhealthy"
        value={formatNumber(counts.DOWN)}
        icon={Zap}
        surface="glass"
      />
      {/*
        The tile this strip exists for. Never merged into "down", and never subtracted from
        "registered" to imply a healthy remainder.
      */}
      <StatTile
        label="Not determinable"
        value={formatNumber(indeterminate)}
        icon={ShieldQuestion}
        surface="glass"
      />
    </div>
  );
}

/**
 * One service, with its instances behind a native `<details>`.
 *
 * <p>`<details>` rather than a state-driven panel: it is keyboard-operable, announced as a
 * disclosure, works before hydration, and adds nothing to the bundle. The instance detail is
 * reference material an operator opens for ONE service during an incident — putting fourteen
 * services' worth of URIs on screen at once buries the row that matters.
 *
 * <p>The probe URI is printed verbatim. A status page that will not say what it asked is one you
 * cannot argue with, and the first thing an operator does with a disputed red row is repeat the
 * check by hand.
 */
function ServiceRow({ service }: { service: ServiceHealth }) {
  const line = [
    `${formatNumber(service.instancesRegistered)} registered`,
    service.instancesUp > 0 ? `${formatNumber(service.instancesUp)} up` : null,
    service.instancesDown > 0 ? `${formatNumber(service.instancesDown)} down` : null,
    service.instancesUnreachable > 0
      ? `${formatNumber(service.instancesUnreachable)} unreachable`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rounded-lg border" data-testid={`system-service-${service.serviceId}`}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-(--space-sm) p-(--space-md)">
          <Server className="size-4 shrink-0 text-foreground-tertiary" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-small font-medium text-foreground">
              {service.serviceId}
            </span>
            <span className="text-label text-foreground-tertiary">
              {service.detail ??
                (service.instancesRegistered === 0
                  ? "No instances are registered. A registration is not evidence a process answers, and its absence is not evidence of death."
                  : line)}
            </span>
          </span>
          <HealthBadge state={service.state} />
          <Eye
            className="size-4 shrink-0 text-foreground-tertiary group-open:hidden"
            aria-hidden="true"
          />
        </summary>

        <div className="border-t px-(--space-md) py-(--space-sm)">
          {service.instances.length === 0 ? (
            <p className="text-small text-foreground-secondary">
              Nothing is registered under this id, so there was no address to probe. That is not
              evidence the service is down — and not evidence it is up.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {service.instances.map((instance) => (
                <InsetRow
                  key={instance.instanceId}
                  as="li"
                  density="compact"
                  primary={<span className="font-mono">{instance.instanceId}</span>}
                  secondary={
                    <span className="flex flex-col gap-0.5">
                      <span className="font-mono">{instance.uri}</span>
                      <span>
                        {responseTime(instance.responseTimeMs)}
                        {instance.detail ? ` — ${instance.detail}` : ""}
                      </span>
                    </span>
                  }
                  trailing={<HealthBadge state={instance.state} />}
                />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

function ComponentRow({ component }: { component: ComponentHealth }) {
  return (
    <InsetRow
      as="li"
      density="compact"
      leading={<Database className="size-4 text-foreground-tertiary" />}
      primary={component.name}
      secondary={component.detail ?? component.kind}
      trailing={<HealthBadge state={component.state} />}
    />
  );
}

/**
 * The reporting-service ClickHouse precondition, given a card of its own.
 *
 * <h3>Why this one is not just another row</h3>
 *
 * `ClickHouseSchemaGuard` refuses to finish `@PostConstruct` unless all four analytics fact tables
 * exist in the configured database — so a reporting-service instance that is SERVING is positive
 * evidence the tables are there. It is the highest-signal check in the fleet precisely because the
 * service will not start without it: one green row here rules out an entire class of silent
 * analytics failure.
 *
 * <h3>And why its `basis` is rendered as prominently as its state</h3>
 *
 * Because the evidence is INFERRED, not observed. platform-admin-service holds no ClickHouse
 * driver and cannot query the tables; what it can see is whether a reporting-service instance
 * answered. So UP here means "a serving instance implies the tables exist", which is a sound
 * inference and is not a measurement — and if no reporting-service instance answered, the state is
 * UNKNOWN rather than DOWN, because nothing was learned either way.
 *
 * <p>A green tick that does not say which of those two things it is has claimed a measurement
 * nobody made. So the basis sits under the badge in the same weight as the rest of the row.
 */
function PreconditionCard({ migration }: { migration: MigrationState }) {
  return (
    <div
      className="flex flex-col gap-(--space-sm) rounded-lg border p-(--space-md)"
      data-testid={`system-precondition-${migration.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
        <span className="font-mono text-small font-medium text-foreground">{migration.name}</span>
        <HealthBadge state={migration.state} />
      </div>
      {migration.detail ? (
        <p className="text-small text-foreground-secondary">{migration.detail}</p>
      ) : null}
      <ConsoleFact label="How this was established" value={migration.basis} absence="Not stated" />
    </div>
  );
}

/**
 * Metrics an operator would expect on a status page and which this platform does not collect.
 *
 * <p>Rendered, not dropped. An omitted tile reads as an oversight and invites the next author to
 * add it with fabricated data; a line saying "queue depth is not collected — no RabbitMQ
 * management client exists in any service" is a status page telling the truth about its own
 * limits. A DLQ chart that is not actually reading a DLQ is worse than no chart.
 */
function NotCollected({ metrics }: { metrics: UncollectedMetric[] }) {
  return (
    <ul className="flex flex-col gap-(--space-sm)">
      {metrics.map((metric) => (
        <li key={metric.name} className="flex gap-2">
          <CircleHelp
            className="mt-0.5 size-4 shrink-0 text-foreground-tertiary"
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-small font-medium text-foreground">{metric.name}</span>
            <span className="text-small text-foreground-secondary">{metric.reason}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A clock, ticking once a minute, so "probed 7 min ago" stays true without the readings pretending
 * to be.
 *
 * <h3>Why the age is allowed to move while nothing else on the page does</h3>
 *
 * Because it is the one number on this screen that IS about the present. Every state, every
 * response time and every basis below was established at `checkedAt` and is frozen there; the age
 * of that snapshot is the reader's only cue that what they are looking at has gone stale. Letting
 * it freeze too — the tidier option — produces a page that says "probed a moment ago" twenty
 * minutes into an incident, which is the same class of untruth as a green tile nobody checked.
 *
 * <h3>Why `Date.now()` is not simply read during render</h3>
 *
 * It is an impure call, and React's rules (and `react-hooks/purity`, which enforces them here)
 * make it a defect rather than a shortcut: a component that reads the clock in its body produces a
 * different tree every time anything unrelated re-renders it, and under a concurrent render the
 * two passes can disagree. A minute-resolution caption does not need that, and the interval is
 * cheap: one timer, one state write, no network.
 *
 * <p>The initial `null` is deliberate rather than a lazy `Date.now()` initializer — the first
 * paint states the absolute stamp alone, and the relative age joins it once there is a clock that
 * is genuinely the client's.
 */
function useProbeAge(): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 60_000);
    // Scheduled rather than called inline: a synchronous `setState` in an effect body is a
    // cascading render, and this value is a caption rather than something the first paint needs.
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, []);
  return now;
}

export function SystemStatusScreen() {
  const health = usePlatformSystemHealth();
  const data = health.data;

  const now = useProbeAge();

  const clickHouse = data?.migrations.find((m) => m.name === CLICKHOUSE_MIGRATION);
  const otherMigrations = data?.migrations.filter((m) => m.name !== CLICKHOUSE_MIGRATION) ?? [];

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <ConsoleSection
        anchorId="system-overall"
        eyebrow="Live"
        title="Fleet status"
        description="Every probe below is made when this page is requested. Nothing is cached — a status page served from a cache is a status page reporting the past."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
            data-testid="system-refresh"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {health.isFetching ? "Probing…" : "Refresh"}
          </Button>
        }
        data-testid="system-overall"
      >
        <QueryBoundary
          query={health}
          what="the fleet health probe"
          moduleLabel="Platform"
          // Named precisely, because the failure of THIS call is not the failure of the fleet.
          stillWorks="This is the console's own read of the control plane. Tenant, subscription, analytics and audit screens read different services and are unaffected by it."
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
              <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
                <span className="flex items-center gap-2">
                  <span className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                    Overall
                  </span>
                  <HealthBadge state={data.overall} />
                  <span className="text-small text-foreground-secondary">
                    {HEALTH_STATE_MEANING[data.overall]}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="font-mono text-label tabular-nums text-foreground-tertiary">
                    {formatDateTime(data.checkedAt)}
                  </span>
                  {now === null ? null : (
                    <span className="text-label text-foreground-tertiary">
                      probed {formatElapsedLong(data.checkedAt, now)} ago
                    </span>
                  )}
                </span>
              </div>

              <SummaryTiles health={data} />

              <ConsoleNote data-testid="system-state-key">
                <span className="mb-1 block font-semibold text-foreground">
                  Four states, and only one of them is green
                </span>
                <span className="block">
                  <span className="font-medium text-foreground-secondary">Down</span> —{" "}
                  {HEALTH_STATE_MEANING.DOWN}
                </span>
                <span className="block">
                  <span className="font-medium text-foreground-secondary">Unreachable</span> —{" "}
                  {HEALTH_STATE_MEANING.UNREACHABLE}
                </span>
                <span className="block">
                  <span className="font-medium text-foreground-secondary">Unknown</span> —{" "}
                  {HEALTH_STATE_MEANING.UNKNOWN}
                </span>
              </ConsoleNote>
            </div>
          ) : null}
        </QueryBoundary>
      </ConsoleSection>

      <ConsoleSection
        anchorId="system-services"
        eyebrow="Registry"
        title="Services"
        description="Worst first. Open a row for the instances behind it, the URI actually probed, and how long each one took to answer."
        data-testid="system-services"
      >
        <QueryBoundary
          query={health}
          what="the service registry"
          moduleLabel="Platform"
          // A registry that answered with no services is a REAL and alarming state, not an empty
          // list to shrug at — every service in this product registers on boot, so zero means the
          // registry itself is not seeing the fleet. It gets a sentence, not an "add one" empty
          // state, because there is nothing here for a reader to create.
          isEmpty={data !== undefined && data.services.length === 0}
          empty={
            <ConsoleNote tone="warning" role="status" data-testid="system-no-services">
              The registry answered and listed no services at all. Every service in this product
              registers on boot, so this is far more consistent with the registry not seeing the
              fleet than with the fleet being absent. Nothing below can be inferred from it either
              way.
            </ConsoleNote>
          }
          loading={
            <div className="flex flex-col gap-(--space-sm)">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          }
        >
          {data ? (
            <ul className="flex flex-col gap-(--space-sm)">
              {data.services.map((service) => (
                <ServiceRow key={service.serviceId} service={service} />
              ))}
            </ul>
          ) : null}
        </QueryBoundary>
      </ConsoleSection>

      <div className="grid gap-(--space-md) lg:grid-cols-2">
        <ConsoleSection
          anchorId="system-infrastructure"
          eyebrow="Dependencies"
          title="Database, cache and broker"
          description="Reachability only. Whether a dependency answers is a different question from whether it is healthy under load, and this page answers the first."
          data-testid="system-infrastructure"
        >
          <QueryBoundary
            query={health}
            what="the infrastructure probes"
            moduleLabel="Platform"
            loading={
              <div className="flex flex-col gap-(--space-sm)">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            }
          >
            {data ? (
              <ul className="flex flex-col gap-1">
                <ComponentRow component={data.registry} />
                {data.infrastructure.map((component) => (
                  <ComponentRow key={component.name} component={component} />
                ))}
              </ul>
            ) : null}
          </QueryBoundary>
        </ConsoleSection>

        <ConsoleSection
          anchorId="system-preconditions"
          eyebrow="Schema"
          title="Deployment preconditions"
          description="The migration and schema state that can take a deployment down, each with how it was established."
          data-testid="system-preconditions"
        >
          <QueryBoundary
            query={health}
            what="the schema preconditions"
            moduleLabel="Platform"
            loading={
              <div className="flex flex-col gap-(--space-sm)">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-28 rounded-lg" />
                ))}
              </div>
            }
          >
            {data ? (
              <div className="flex flex-col gap-(--space-md)">
                {/*
                  The ClickHouse precondition first, and by name. reporting-service refuses to
                  finish starting unless all four analytics fact tables exist, so a serving
                  instance is the strongest single piece of evidence available anywhere on this
                  page — and its absence is the quietest failure, because analytics simply
                  returns nothing rather than erroring.

                  The `find` is by a stable constant and the remainder renders unconditionally, so
                  a rename on the backend moves this row into the list below rather than deleting
                  it from the screen. A precondition that vanishes because a string changed is the
                  failure mode this whole page is against.
                */}
                {clickHouse ? <PreconditionCard migration={clickHouse} /> : null}
                {otherMigrations.map((migration) => (
                  <PreconditionCard key={migration.name} migration={migration} />
                ))}
                {data.migrations.length === 0 ? (
                  <ConsoleNote tone="warning">
                    No preconditions were reported. This page cannot tell whether that means there
                    are none to check or that the check itself did not run.
                  </ConsoleNote>
                ) : null}
              </div>
            ) : null}
          </QueryBoundary>
        </ConsoleSection>
      </div>

      <ConsoleSection
        anchorId="system-not-collected"
        eyebrow="Provenance"
        title="Not collected anywhere"
        description="Named rather than omitted. A gap reads as an oversight and invites the next author to fill it with a plausible number."
        data-testid="system-not-collected"
      >
        <QueryBoundary
          query={health}
          what="the list of uncollected metrics"
          moduleLabel="Platform"
          hideRetry
          isEmpty={data !== undefined && data.notCollected.length === 0}
          empty={
            <ConsoleNote>
              The status endpoint named no uncollected metrics on this request. That is a statement
              about the response, not a claim that everything is instrumented.
            </ConsoleNote>
          }
          loading={
            <div className="flex flex-col gap-(--space-sm)">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          }
        >
          {data ? <NotCollected metrics={data.notCollected} /> : null}
        </QueryBoundary>
      </ConsoleSection>
    </div>
  );
}

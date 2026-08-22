"use client";

import * as React from "react";
import { Activity, Database, RefreshCw, Server } from "lucide-react";

import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { Button } from "@/components/ui/button";
import { CardEyebrow } from "@/components/ui/card";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { InsetRow } from "@/components/ui/inset-row";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBadge } from "@/components/platform/health-badge";
import { usePlatformSystemHealth } from "@/lib/hooks/use-platform-overview";
import type { SystemHealth } from "@/lib/models/platform-overview.model";

/**
 * Fleet status — probed live, and never green out of ignorance.
 *
 * <h3>The four states are four states</h3>
 *
 * `UP` answered and said it was healthy. `DOWN` answered and said it was not. `UNREACHABLE` means
 * nothing answered, which is consistent with the process being dead AND with a network partition,
 * a wrong registry entry, or the platform service being the isolated one. `UNKNOWN` means there
 * was nothing to probe at all. The backend spends four enum members on this because at 3am they
 * call for different actions, and a console that renders three of them identically has thrown
 * away the distinction that was paid for.
 *
 * <p>So each maps to its own badge, and **none of them maps to `success` except `UP`**. A status
 * page's whole job is to be believed during an incident, and the fastest way to lose that is one
 * tile that shows green because nobody checked.
 *
 * <h3>`notCollected` is rendered, not dropped</h3>
 *
 * The response names the metrics an operator would reasonably expect here and which this platform
 * does not collect anywhere — queue depth, DLQ size — with the reason for each. An omitted tile
 * reads as an oversight and invites the next author to add it with fabricated data; a line that
 * says "queue depth is not collected — no RabbitMQ management client exists in any service" is a
 * status page telling the truth about its own limits. A DLQ chart that is not reading a DLQ is
 * worse than no chart.
 *
 * <h3>Why there is a Refresh button and no polling timer</h3>
 *
 * Every probe in this document is made when the request arrives — there is no server-side cache,
 * deliberately, because a status page served from a cache reports the past. A client-side poll
 * would put that cost on a timer for a reader who has walked away, and would probe every actuator
 * in the fleet to do it. The reader asks when the reader wants to know.
 */

/*
 * The state -> badge table used to live here as a local constant and now lives in
 * `components/platform/health-badge.tsx`, imported by this card AND by the full system status
 * screen. Four states, four variants, four words — small enough to retype, and small enough for
 * the retyped copy to drift by one line. The drift that matters is specific: `UNKNOWN` mapped to
 * `success` on one of the two surfaces because a grey chip looked broken, and the console then
 * shows green for a component nobody managed to probe.
 */

/**
 * The instance line under a service.
 *
 * <p>Registered / up / unreachable, stated separately rather than collapsed to "2 of 3". A service
 * with three registrations and zero answers is a different fact from one with three registrations
 * and one `DOWN`, and the second number is the one that tells an operator whether to look at the
 * process or at the network.
 */
function instanceLine(service: SystemHealth["services"][number]): string {
  if (service.instancesRegistered === 0) {
    return "No instances are registered. A registration is not evidence a process answers, and its absence is not evidence of death.";
  }
  const parts = [`${formatNumber(service.instancesRegistered)} registered`];
  if (service.instancesUp > 0) parts.push(`${formatNumber(service.instancesUp)} up`);
  if (service.instancesDown > 0) parts.push(`${formatNumber(service.instancesDown)} down`);
  if (service.instancesUnreachable > 0) {
    parts.push(`${formatNumber(service.instancesUnreachable)} unreachable`);
  }
  return parts.join(" · ");
}

function HealthSection({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-(--space-sm)">
      <CardEyebrow>{eyebrow}</CardEyebrow>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

export function OverviewSystem() {
  const health = usePlatformSystemHealth();
  const data = health.data;

  return (
    <ConsoleSection
      anchorId="platform-system"
      eyebrow="Health"
      title="Fleet status"
      description="Probed live on every request. Nothing here is cached, and nothing is green because nobody checked."
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {health.isFetching ? "Probing…" : "Refresh"}
        </Button>
      }
    >
      <QueryBoundary
        query={health}
        what="the fleet health probe"
        moduleLabel="Platform"
        stillWorks="Tenant, subscription and user screens read different services and are unaffected by this."
        loading={
          <div className="flex flex-col gap-(--space-sm)">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-(--space-lg)">
            <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
              <span className="flex items-center gap-2">
                <Activity className="size-4 text-foreground-tertiary" aria-hidden="true" />
                <span className="text-small font-semibold text-foreground">Overall</span>
                <HealthBadge state={data.overall} />
              </span>
              {/* The instant the probes were taken, pinned to one locale and one zone. A status
                  page that will not say WHEN it looked is one you cannot argue with. */}
              <span className="font-mono text-label tabular-nums text-foreground-tertiary">
                {formatDateTime(data.checkedAt)}
              </span>
            </div>

            <HealthSection eyebrow="Services">
              {data.services.map((service) => (
                <InsetRow
                  key={service.serviceId}
                  as="li"
                  density="compact"
                  leading={<Server className="size-4 text-foreground-tertiary" />}
                  primary={<span className="font-mono">{service.serviceId}</span>}
                  secondary={service.detail ?? instanceLine(service)}
                  trailing={<HealthBadge state={service.state} />}
                />
              ))}
            </HealthSection>

            <HealthSection eyebrow="Infrastructure">
              <InsetRow
                as="li"
                density="compact"
                leading={<Database className="size-4 text-foreground-tertiary" />}
                primary={data.registry.name}
                secondary={data.registry.detail ?? data.registry.kind}
                trailing={<HealthBadge state={data.registry.state} />}
              />
              {data.infrastructure.map((component) => (
                <InsetRow
                  key={component.name}
                  as="li"
                  density="compact"
                  leading={<Database className="size-4 text-foreground-tertiary" />}
                  primary={component.name}
                  secondary={component.detail ?? component.kind}
                  trailing={<HealthBadge state={component.state} />}
                />
              ))}
            </HealthSection>

            {data.migrations.length > 0 && (
              <HealthSection eyebrow="Schema preconditions">
                {data.migrations.map((migration) => (
                  <InsetRow
                    key={migration.name}
                    as="li"
                    density="compact"
                    leading={<Database className="size-4 text-foreground-tertiary" />}
                    primary={migration.name}
                    // The BASIS travels with the row. The ClickHouse fact tables are INFERRED from
                    // reporting-service booting rather than observed directly — this service holds
                    // no ClickHouse driver — and a green tick that does not say so has claimed a
                    // measurement nobody made.
                    secondary={`${migration.detail ? `${migration.detail} — ` : ""}${migration.basis}`}
                    trailing={<HealthBadge state={migration.state} />}
                  />
                ))}
              </HealthSection>
            )}

            {data.notCollected.length > 0 && (
              <ConsoleNote>
                <span className="mb-1 block font-semibold text-foreground">
                  Not collected anywhere
                </span>
                {data.notCollected.map((metric) => (
                  <span key={metric.name} className="mt-1 block">
                    <span className="font-medium text-foreground-secondary">{metric.name}</span> —{" "}
                    {metric.reason}
                  </span>
                ))}
              </ConsoleNote>
            )}
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

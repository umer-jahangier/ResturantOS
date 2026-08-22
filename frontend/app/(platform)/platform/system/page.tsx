"use client";

import { PageHeader } from "@/components/ui/page-header";
import { SystemStatusScreen } from "@/components/platform/system-status";

/**
 * URL: `/platform/system` — live probes of every service, database, cache and broker.
 *
 * <h3>The one rule</h3>
 *
 * **Anything this console cannot truthfully determine renders as UNKNOWN, never as green.** A
 * status page that shows green because it failed to ask is worse than no status page — it converts
 * an absence of information into a reassurance, at the exact moment somebody is relying on it. So
 * there is no default-healthy path anywhere behind this screen: a probe that times out is
 * UNREACHABLE, a registry that cannot be consulted is UNKNOWN, and a metric nobody collects is
 * named as uncollected rather than omitted.
 *
 * <p>`DOWN` and `UNREACHABLE` stay separate all the way to the badge. DOWN means the process
 * answered and said it was unhealthy — a real, self-reported fact. UNREACHABLE means nothing
 * answered, which is equally consistent with a network partition, a stale registry entry, or the
 * platform service being the isolated one. At 3am those call for different actions, and a console
 * that renders them identically has thrown away the distinction the backend spent an enum member
 * on.
 *
 * <h3>Not cached, and not polled</h3>
 *
 * The endpoint makes every probe when the request arrives and the client hook sets `staleTime: 0`,
 * because a status page served from a cache reports the past and the moment it matters is the
 * moment the past is wrong. There is deliberately no `refetchInterval`: a timer would probe every
 * actuator in the fleet on behalf of a reader who has walked away. The Refresh control is the same
 * information, on demand.
 *
 * <h3>The highest-signal check on the page</h3>
 *
 * `clickhouse.analytics_fact_tables`, given a card of its own. reporting-service refuses to finish
 * starting unless all four analytics fact tables exist, so a serving instance is positive evidence
 * that they do — and its absence is the quietest failure in the product, because analytics then
 * returns nothing rather than erroring. Its `basis` is rendered as prominently as its state,
 * because the evidence is INFERRED: this service holds no ClickHouse driver and a green tick that
 * does not say so has claimed a measurement nobody made.
 */
export default function PlatformSystemPage() {
  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="System status"
        description="Probed live on every request. Nothing here is cached, and nothing is green because nobody managed to check it."
      />
      <SystemStatusScreen />
    </div>
  );
}

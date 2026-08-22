"use client";

import { AlertTriangle, Building2, CircleCheck, PauseCircle } from "lucide-react";

import { formatNumber } from "@/lib/format/locale";
import { CardEyebrow } from "@/components/ui/card";
import { ConsoleSection } from "@/components/platform/console-section";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { usePlatformAnalyticsOverview } from "@/lib/hooks/use-platform-overview";
import type { TenantPopulation } from "@/lib/models/platform-overview.model";

/**
 * The fleet: how many restaurant groups exist, what state they are in, and on which tier.
 *
 * <h3>Every figure here is counted by the platform database</h3>
 *
 * `GET /platform/analytics/overview` groups `platform_db.tenants` by status and by tier and
 * densifies both against the compiled enums, so a status with no tenants comes back as a REAL
 * zero rather than as an absent key. That densification is legitimate where a time bucket's would
 * not be: the status set is closed and compiled in, so "no tenant is currently PURGED" is
 * something the table can actually establish.
 *
 * <h3>Why the accent rail stops after the second tile</h3>
 *
 * `StatTile`'s decorative rail may carry `primary` or `secondary` and never a state hue — a rail
 * painted `danger` would be a second, hand-picked state channel on a tile whose real state channel
 * is derived. So the strip uses the rail for GROUPING rather than for severity: the two population
 * tiles carry the fleet's hue, the two attention tiles carry a flat top edge, and the severity
 * they actually have is stated where it belongs — in the alerts feed, in words, with a tone.
 */

/** Human labels for the backend's SCREAMING_SNAKE enum names. */
const STATUS_LABEL: Record<string, string> = {
  PROVISIONING: "Provisioning",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
  PURGED: "Purged",
  PROVISIONING_FAILED: "Provisioning failed",
};

const TIER_LABEL: Record<string, string> = {
  STARTER: "Starter",
  GROWTH: "Growth",
  ENTERPRISE: "Enterprise",
  CUSTOM: "Custom",
};

/**
 * A distribution column.
 *
 * <p>`Meter` is used rather than a bare count because the denominator is what makes a count
 * readable: "4 suspended" means something different across a fleet of 6 and a fleet of 60, and the
 * primitive requires the denominator precisely so a caller cannot omit it. The order is the
 * server's — the map is built over the compiled enum — so the column cannot disagree with the
 * backend about what the set of statuses is.
 */
function Distribution({
  eyebrow,
  entries,
  total,
  labels,
  noun,
}: {
  eyebrow: string;
  entries: [string, number][];
  total: number;
  labels: Record<string, string>;
  noun: string;
}) {
  return (
    <div className="flex flex-col gap-(--space-md)">
      <CardEyebrow>{eyebrow}</CardEyebrow>
      <div className="flex flex-col gap-(--space-sm)">
        {entries.map(([key, count]) => (
          <Meter
            key={key}
            label={labels[key] ?? key}
            value={count}
            of={total}
            noun={noun}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * `SUSPENDED` deliberately gets no tile of its own: it is inside `Not serving traffic` above AND a
 * row of the status distribution below, and a figure that appears three times on one screen is
 * three chances for two of them to disagree after the next change.
 *
 * <p>`?? 0` is safe for exactly one key and only because the backend densifies `byStatus` against
 * the compiled `TenantStatus` enum before serialising — every declared status is present with a
 * real zero. If that key is ever genuinely absent the enum has changed underneath this console,
 * and a zero is then the right reading of "this platform has no such state".
 */
function FleetTiles({ population }: { population: TenantPopulation }) {
  const failed = population.byStatus["PROVISIONING_FAILED"] ?? 0;

  return (
    <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Tenants"
        value={formatNumber(population.total)}
        icon={Building2}
        accent="primary"
        surface="glass"
        drillTo="/platform/tenants"
        drillLabel="Manage tenants"
      />
      <StatTile
        label="Active"
        value={formatNumber(population.active)}
        icon={CircleCheck}
        accent="primary"
        surface="glass"
      />
      <StatTile
        label="Not serving traffic"
        value={formatNumber(population.inactive)}
        icon={PauseCircle}
        surface="glass"
      />
      <StatTile
        label="Provisioning failed"
        value={formatNumber(failed)}
        icon={AlertTriangle}
        surface="glass"
      />
    </div>
  );
}

export function OverviewFleet() {
  const overview = usePlatformAnalyticsOverview();
  const population = overview.data?.tenants;

  return (
    <ConsoleSection
      anchorId="platform-fleet"
      eyebrow="Fleet"
      title="Tenants on the platform"
      description="Counted from platform_db.tenants at the moment this page was opened."
    >
      <QueryBoundary
        query={overview}
        what="the tenant population"
        moduleLabel="Platform"
        isEmpty={population !== undefined && population.total === 0}
        empty={
          <EmptyState
            icon={Building2}
            title="No tenants yet"
            description="Provision the first restaurant group and this console starts reporting on it."
          />
        }
        loading={
          <div className="grid gap-(--space-md) md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        }
      >
        {population ? (
          <div className="flex flex-col gap-(--space-lg)">
            <FleetTiles population={population} />

            <div className="grid gap-(--space-lg) md:grid-cols-2">
              <Distribution
                eyebrow="By status"
                entries={Object.entries(population.byStatus)}
                total={population.total}
                labels={STATUS_LABEL}
                noun="tenants"
              />
              <Distribution
                eyebrow="By tier"
                entries={Object.entries(population.byTier)}
                total={population.total}
                labels={TIER_LABEL}
                noun="tenants"
              />
            </div>
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

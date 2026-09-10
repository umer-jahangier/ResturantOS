"use client";

import * as React from "react";
import { Gauge } from "lucide-react";

import { formatNumber } from "@/lib/format/locale";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Meter, type MeterStatus } from "@/components/ui/meter";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformUsageRollup } from "@/lib/hooks/use-platform-analytics";
import { meterUnavailableReason, type MeterRollup } from "@/lib/models/platform-analytics.model";

/**
 * Usage across the fleet, measured against what the fleet is entitled to.
 *
 * <h3>Why a roll-up cannot be a single number</h3>
 *
 * The per-tenant usage endpoint answers three ways per dimension — counted, not-metered,
 * unreadable — because two of the four dimensions are one internal HTTP call per tenant and one is
 * a Redis key that may never have been written. So a sum across tenants is a number PLUS how many
 * tenants it actually covers. "1,240 branches" computed from nine of fourteen tenants is a
 * different fact from the same figure computed from fourteen, and the difference is precisely what
 * an operator would act on.
 *
 * <p>Every meter here therefore prints its coverage under it, and `complete: false` is stated in
 * words rather than implied by a smaller number.
 *
 * <h3>Why `Meter` and not a `StatTile`</h3>
 *
 * Because the entitlement side is real and knowable. `limitTotal` is summed from the tier ceilings
 * stamped on each tenant row, so it is available even when the usage side is not — which is
 * exactly the shape `Meter`'s required denominator was built for. A tile would show "412
 * branches" and leave the reader to wonder whether that is comfortable or one provisioning away
 * from a refusal.
 *
 * <h3>There is no money on this screen and none is missing</h3>
 *
 * These four dimensions are what this platform meters: branches, user accounts, storage and NLQ
 * queries. Storage has no producer at all — file-service emits no usage event — and it renders as
 * the stated absence the backend sends rather than as a zero bar, because a zero bar would say the
 * fleet is storing nothing.
 */

/**
 * Scope, as the backend defines it: `ALL` or a `TenantStatus` name.
 *
 * <p>`ACTIVE` is first and is the default, matching the server's. A cancelled tenant's branch
 * count is not fleet capacity, and the two expensive dimensions fan out per tenant — so widening
 * the scope is a real cost the reader is choosing to pay, not a free toggle.
 */
const SCOPE_OPTIONS = [
  { value: "ACTIVE", label: "Active tenants" },
  { value: "ALL", label: "Every tenant" },
  { value: "PROVISIONING", label: "Provisioning" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "PROVISIONING_FAILED", label: "Provisioning failed" },
] as const;

const RESOURCE_LABEL: Record<string, string> = {
  branches: "Branches",
  users: "User accounts",
  storage_gb: "Storage",
  nlq_queries: "Natural-language queries this month",
};

function resourceLabel(meter: MeterRollup): string {
  return RESOURCE_LABEL[meter.resource] ?? meter.resource.replace(/_/g, " ");
}

/**
 * Judgment, and only where it is earned.
 *
 * <p>No status is returned for an incomplete sum. A "92% of capacity" warning computed from nine
 * of fourteen tenants is a warning about a number that is not the number, and the tone would make
 * a partial reading look like a settled one. The hue is never the only channel — `MeterStatus`
 * requires the word — but a word attached to a figure that does not mean what it says is worse
 * than no word.
 */
function capacityStatus(meter: MeterRollup): MeterStatus | undefined {
  if (!meter.complete || meter.total === null || meter.limitTotal <= 0) return undefined;
  const ratio = meter.total / meter.limitTotal;
  if (ratio >= 1) return { tone: "danger", label: "At or over the fleet ceiling" };
  if (ratio >= 0.85) return { tone: "warning", label: "Approaching the fleet ceiling" };
  return undefined;
}

/**
 * How this dimension was obtained, under the bar.
 *
 * <p>The three tenant counts are printed separately rather than summarised. "Counted 9,
 * not metered 3, unreadable 2" is three different facts about three different sets of tenants:
 * the first is data, the second is a permanent property of the product, and the third is a live
 * outage somebody can chase. A single "9 of 14" would flatten all three.
 */
function CoverageLine({ meter }: { meter: MeterRollup }) {
  const parts: string[] = [`${formatNumber(meter.tenantsCounted)} counted`];
  if (meter.tenantsNotMetered > 0) {
    parts.push(`${formatNumber(meter.tenantsNotMetered)} not metered`);
  }
  if (meter.tenantsUnreadable > 0) {
    parts.push(`${formatNumber(meter.tenantsUnreadable)} did not answer`);
  }
  return (
    <p className="text-label text-foreground-tertiary">
      <span className={meter.complete ? undefined : "font-semibold text-warning"}>
        {parts.join(" · ")}
      </span>
      {meter.complete ? null : " — this total covers only part of the scope."} {meter.source}.
    </p>
  );
}

function UsageMeter({ meter }: { meter: MeterRollup }) {
  const reason = meterUnavailableReason(meter);
  return (
    <div className="flex flex-col gap-1" data-testid={`usage-meter-${meter.resource}`}>
      {/*
        The two branches are not a style choice — `MeterProps` is a union that refuses a value and
        an `unavailableReason` in the same call, so a dimension nothing could count is structurally
        incapable of rendering as a number here. That is the guard, and it is why the branch is
        written out rather than collapsed into one call with a ternary on `value`.
      */}
      {reason === null ? (
        <Meter
          label={resourceLabel(meter)}
          value={meter.total!}
          of={meter.limitTotal}
          noun={meter.unit}
          ofLabel="Fleet ceiling"
          status={capacityStatus(meter)}
          size="md"
        />
      ) : (
        <Meter
          label={resourceLabel(meter)}
          value={null}
          of={meter.limitTotal}
          unavailableReason={reason}
          noun={meter.unit}
          size="md"
        />
      )}
      <CoverageLine meter={meter} />
    </div>
  );
}

export function AnalyticsUsage() {
  const [scope, setScope] = React.useState("ACTIVE");
  const usage = usePlatformUsageRollup(scope);
  const data = usage.data;

  return (
    <ConsoleSection
      anchorId="platform-usage"
      eyebrow="Capacity"
      title="Usage against entitlement"
      description={
        data
          ? `Rolled up across ${formatNumber(data.tenantsInScope)} tenant${data.tenantsInScope === 1 ? "" : "s"}. Each total states how many of them it actually covers.`
          : "Each total states how many tenants it actually covers — a sum over part of the fleet is a different fact from a sum over all of it."
      }
      action={
        <div className="flex items-center gap-2">
          <Label htmlFor="usage-scope" className="text-label text-foreground-tertiary">
            Scope
          </Label>
          <Select
            id="usage-scope"
            data-testid="usage-scope"
            className="w-44"
            options={SCOPE_OPTIONS}
            value={scope}
            onValueChange={setScope}
          />
        </div>
      }
      data-testid="analytics-usage"
    >
      <QueryBoundary
        query={usage}
        what="the platform usage roll-up"
        moduleLabel="Platform"
        stillWorks="Tenant, growth and audit screens read different services and are unaffected by this."
        // A scope that resolves to no tenants is an EMPTY state and not a zero reading. "No
        // suspended tenants" and "suspended tenants are using nothing" are different sentences and
        // only one of them is true here.
        isEmpty={data !== undefined && data.tenantsInScope === 0}
        empty={
          <EmptyState
            icon={Gauge}
            title="No tenants in this scope"
            description="There is nothing to roll up. This is not a reading of zero usage — no tenant matched the scope at all."
          />
        }
        loading={
          <div className="flex flex-col gap-(--space-md)">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        }
      >
        {data ? (
          <div className="flex flex-col gap-(--space-lg)">
            {data.scopeTruncated && (
              <ConsoleNote tone="warning" role="status" data-testid="usage-truncated">
                The scope exceeded this endpoint&apos;s fan-out ceiling and only the first{" "}
                {formatNumber(data.tenantsInScope)} tenants were read. Every total below is a lower
                bound over a subset, not a fleet figure.
              </ConsoleNote>
            )}

            {!data.anyMetered && (
              <ConsoleNote tone="warning" data-testid="usage-nothing-metered">
                Not one dimension is recorded for any tenant in this scope. That is one fact, not
                four separate omissions: the meters below say what each one would have read and why
                it could not.
              </ConsoleNote>
            )}

            <div className="flex flex-col gap-(--space-lg)">
              {data.meters.map((meter) => (
                <UsageMeter key={meter.resource} meter={meter} />
              ))}
            </div>

            <ConsoleNote>
              Ceilings are summed from the tier limits stamped on each tenant row, so they are known
              even where the usage side is not. A dimension with no reading shows an em dash and its
              reason — never a zero, which would claim the fleet is using none of it.
            </ConsoleNote>
          </div>
        ) : null}
      </QueryBoundary>
    </ConsoleSection>
  );
}

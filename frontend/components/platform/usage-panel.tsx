"use client";

import * as React from "react";

import { Meter } from "@/components/ui/meter";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatNumber } from "@/lib/format/locale";
import { useTenantUsage } from "@/lib/hooks/use-platform-usage";
import {
  meterLabel,
  meterPercent,
  meterSeverity,
  type UsageMeter,
} from "@/lib/models/platform.model";

/**
 * Usage against entitlement (UI-SPEC §7.5), reporting only what is actually measured.
 *
 * <h3>Why most of this panel says "Not metered"</h3>
 *
 * Because that is true. Checked against the live platform before a line of this component was
 * written: `select count(*) from usage_records` returns **0**, the audit confirms **0 producers**,
 * and `redis --scan 'nlq_quota:*'` returns **0 keys**. Exactly one dimension — branches — has a real
 * count, obtained from the same user-service call the tier-downgrade check already trusts.
 *
 * <h3>Why it does not render 0</h3>
 *
 * A 0% bar is a claim: it says we counted and found nothing. For users, storage and NLQ nobody is
 * counting, and "0 / 500 users" beside a tenant with forty staff is not an incomplete feature — it
 * is a false statement in the product's own confident voice, on a screen whose entire purpose is to
 * inform capacity decisions. An unreadable meter is distinguished from an unmetered one for the same
 * reason the tenant-status check refuses an undeterminable status: not knowing is not the same as
 * knowing it is zero.
 *
 * <h3>The entitlement half is real even when the usage half is not</h3>
 *
 * Those four ceilings have been returned by the API since Phase 3 and were read by nothing (GA-083).
 * So an unmetered row still states its ceiling in words — "Limit 500 users" — inside the same
 * sentence that says the consumption is not collected. Showing the entitlement alone is honest;
 * pairing it with an invented numerator is not.
 *
 * <h3>Why `Meter` and not a hand-rolled bar</h3>
 *
 * `Meter`'s props are a discriminated union: a null reading MUST arrive with a reason and a real
 * reading may not carry one, so the compiler refuses the shape this screen exists to avoid. Its
 * unknown state draws a dashed empty track rather than a full-width one at 0%, which is the visual
 * difference between "no measurement" and "measured none". A second bar written here would be a
 * second place to get that wrong.
 */
export function UsagePanel({ tenantId }: { tenantId: string }) {
  const usage = useTenantUsage(tenantId);

  return (
    <ConsoleSection
      anchorId="usage"
      eyebrow="Usage"
      title="Usage against entitlement"
      description="What this tenant's tier allows, and what it has actually consumed where anything is counting."
      data-testid="tenant-usage"
    >
      <QueryBoundary
        query={usage}
        what="this tenant's usage"
        loading={<Skeleton className="h-32" />}
      >
        <div className="flex flex-col gap-(--space-md)">
          {usage.data && !usage.data.anyMetered && (
            <ConsoleNote data-testid="usage-nothing-metered">
              No usage is recorded for this tenant on any dimension. The entitlement ceilings below
              are real; the consumption figures are not collected yet, so none are shown. One honest
              banner rather than four identical rows, because this is one platform-wide fact and not
              four separate omissions.
            </ConsoleNote>
          )}

          <ul className="flex flex-col gap-(--space-md)" data-testid="usage-meters">
            {usage.data?.meters.map((meter) => (
              <li
                key={meter.resource}
                data-testid={`usage-meter-${meter.resource}`}
                data-metered={meter.metered}
                data-unavailable={meter.unavailable}
              >
                <UsageMeterRow meter={meter} />
              </li>
            ))}
          </ul>
        </div>
      </QueryBoundary>
    </ConsoleSection>
  );
}

/** The ceiling as words, for the sentence an unmeasured row renders instead of a bar. */
function ceilingPhrase(meter: UsageMeter): string {
  return meter.limit < 0 ? "Uncapped" : `Limit ${formatNumber(meter.limit)} ${meter.unit}`;
}

function UsageMeterRow({ meter }: { meter: UsageMeter }) {
  const percent = meterPercent(meter);
  const severity = meterSeverity(meter);
  const label = meterLabel(meter.resource);

  // A real count with no ceiling to measure it against. The number is known and is stated; there is
  // simply no denominator, and `Meter` requires one — inventing a ceiling to draw a bar would be
  // the fabrication this whole panel refuses.
  if (meter.metered && !meter.unavailable && meter.used !== null && meter.limit < 0) {
    return (
      <Meter
        label={label}
        value={null}
        of={0}
        unavailableReason={`Uncapped — ${formatNumber(meter.used)} ${meter.unit} recorded, with no ceiling to measure against. ${meter.source}`}
      />
    );
  }

  // `meterPercent` returns null for every state that has no honest reading, so this branch covers
  // unmetered, unreadable and no-denominator alike — each with its own first word.
  //
  // The `used === null` test is redundant with it and is written anyway: it is what lets the branch
  // below use `meter.used` directly instead of `meter.used ?? 0`. A `?? 0` here would compile, would
  // be unreachable today, and would be the single character that turns "nobody counted" into "we
  // counted none" the first time somebody widens `meterPercent`.
  if (percent === null || meter.used === null) {
    return (
      <Meter
        label={label}
        value={null}
        of={meter.limit > 0 ? meter.limit : 0}
        unavailableReason={`${meter.unavailable ? "Could not be read" : "Not metered"}. ${ceilingPhrase(meter)}. ${meter.source}`}
      />
    );
  }

  return (
    <Meter
      label={label}
      value={meter.used}
      of={meter.limit}
      noun={meter.unit}
      ofLabel="Tier ceiling"
      status={
        severity === "danger"
          ? {
              tone: "danger",
              label: `Over by ${formatNumber(meter.used - meter.limit)} ${meter.unit}`,
            }
          : severity === "warning"
            ? { tone: "warning", label: `${formatNumber(Math.round(percent))}% used` }
            : { tone: "success", label: "Within tier" }
      }
    />
  );
}

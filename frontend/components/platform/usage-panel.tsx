"use client";

import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format/locale";
import { QueryBoundary } from "@/components/ui/query-boundary";
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
 * <h3>Why most of this screen says "Not metered"</h3>
 *
 * Because that is true. Checked against the live platform before a line of this component was
 * written: `select count(*) from usage_records` returns **0**, the audit confirms **0 producers**,
 * and `redis --scan 'nlq_quota:*'` returns **0 keys**. Exactly one dimension — branches — has a
 * real count, obtained from the same user-service call the tier-downgrade check already trusts.
 *
 * The spec describes meters with used/limit bars, `--warning` at 80% and `--danger` at 100%. Those
 * are implemented and they render for the resource that has a number. For the three that do not,
 * this component states so in words and names the reason.
 *
 * <h3>Why it does not render 0</h3>
 *
 * A 0% bar is a claim: it says we counted and found nothing. For users, storage and NLQ nobody is
 * counting, and "0 / 500 users" beside a tenant with forty staff is not an incomplete feature — it
 * is a false statement in the product's own confident voice, on a screen whose entire purpose is
 * to inform capacity and billing decisions. That is the same failure mode as GA-001, where eleven
 * screens rendered an empty state for a failed request; the remedy is the same, and it is not to
 * make the screen look calmer.
 *
 * An unreadable meter is distinguished from an unmetered one for the same reason 13-03 refuses an
 * undeterminable tenant status: not knowing is not the same as knowing it is zero.
 */
export function UsagePanel({ tenantId }: { tenantId: string }) {
  const usage = useTenantUsage(tenantId);

  return (
    <section className="space-y-3" aria-labelledby="usage-heading">
      <h2 id="usage-heading" className="text-lg font-semibold">
        Usage against entitlement
      </h2>

      <QueryBoundary query={usage} what="this tenant's usage">
        <div className="space-y-3">
          {usage.data && !usage.data.anyMetered && (
            <p
              role="note"
              data-testid="usage-nothing-metered"
              className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                No usage is currently recorded for this tenant. Entitlement ceilings below are real;
                the consumption figures are not collected yet, so none are shown.
              </span>
            </p>
          )}

          <ul className="space-y-2" data-testid="usage-meters">
            {usage.data?.meters.map((meter) => (
              <li key={meter.resource}>
                <MeterRow meter={meter} />
              </li>
            ))}
          </ul>
        </div>
      </QueryBoundary>
    </section>
  );
}

function MeterRow({ meter }: { meter: UsageMeter }) {
  const pct = meterPercent(meter);
  const severity = meterSeverity(meter);
  const uncapped = meter.limit < 0;

  return (
    <div
      className="rounded-lg border p-3"
      data-testid={`usage-meter-${meter.resource}`}
      data-metered={meter.metered}
      data-unavailable={meter.unavailable}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{meterLabel(meter.resource)}</span>
        <span className="text-sm tabular-nums">
          {meter.used !== null ? (
            <>
              <span
                className={cn(
                  "font-semibold",
                  severity === "danger" && "text-destructive",
                  severity === "warning" && "text-warning",
                )}
              >
                {formatNumber(meter.used)}
              </span>
              <span className="text-muted-foreground">
                {" / "}
                {uncapped ? "uncapped" : formatNumber(meter.limit)} {meter.unit}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {/*
                The limit is real even when the usage is not — those four ceilings have been
                returned by the API since Phase 3 and read by nothing (GA-083). Showing the
                entitlement alone is honest; pairing it with an invented numerator is not.
              */}
              Limit {uncapped ? "uncapped" : formatNumber(meter.limit)} {meter.unit}
            </span>
          )}
        </span>
      </div>

      {pct !== null ? (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuenow={meter.used ?? undefined}
          aria-valuemin={0}
          aria-valuemax={meter.limit}
          aria-label={`${meterLabel(meter.resource)} used`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              severity === "danger"
                ? "bg-destructive"
                : severity === "warning"
                  ? "bg-warning"
                  : "bg-primary-solid",
            )}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      ) : (
        // Deliberately NOT a 0%-width bar. An empty track reads as "nothing used"; the absence of
        // a track reads as "no measurement", which is the true statement.
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span className="font-medium">
            {meter.unavailable ? "Could not be read" : "Not metered"}
          </span>
          {" — "}
          {meter.source}
        </p>
      )}

      {pct !== null && severity !== "ok" && (
        <p
          className={cn(
            "mt-1.5 text-xs",
            severity === "danger" ? "text-destructive" : "text-warning",
          )}
        >
          {severity === "danger"
            ? `Over the tier ceiling by ${formatNumber((meter.used ?? 0) - meter.limit)} ${meter.unit}.`
            : `${Math.round(pct)}% of the tier ceiling used.`}
        </p>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Loader,
  PlugZap,
  ServerCrash,
} from "lucide-react";

import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { readElapsed } from "@/lib/format/elapsed";
import {
  ActivityFeed,
  ActivityRow,
  ActivitySubject,
  type ActivityTone,
} from "@/components/ui/activity-row";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallClock } from "@/lib/hooks/ui/use-wall-clock";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import {
  usePlatformSubscriptionRegister,
  usePlatformSystemHealth,
} from "@/lib/hooks/use-platform-overview";
import type { PlatformTenant } from "@/lib/models/platform.model";
import type { SubscriptionRegister, SystemHealth } from "@/lib/models/platform-overview.model";

/**
 * Everything on this console that a human has to do something about.
 *
 * <h3>Four sources, and every one of them is a fact the backend actually reports</h3>
 *
 * <ol>
 *   <li><b>Tenants stuck in provisioning.</b> `PROVISIONING_FAILED` is a state a human has to act
 *       on — such a tenant has no working administrator account until it is re-driven, and
 *       `POST /tenants/{id}/retry-provisioning` exists precisely because it was previously
 *       unrecoverable through the API. `PROVISIONING` that has not moved is the same worklist one
 *       step earlier.</li>
 *   <li><b>Trials and renewals.</b> `TRIALING` with an end date, `TRIAL_ENDED` awaiting a
 *       decision, and `renewalOverdue` — all three derived by the server against its own clock in
 *       the request that read the rows.</li>
 *   <li><b>Services failing their health probe.</b> `DOWN` (it answered and said so) and
 *       `UNREACHABLE` (nothing answered) are separate tones, because at 3am they call for
 *       different actions and collapsing them loses the difference between "that service is
 *       broken" and "I cannot see that service".</li>
 *   <li><b>Migration preconditions.</b> A Liquibase state or a schema precondition that is not UP
 *       is what takes a deployment down.</li>
 * </ol>
 *
 * <h3>Why the three queries fail as a UNIT</h3>
 *
 * `QueryBoundary` given an array renders one error if any member failed, and that is the correct
 * behaviour for an alerts panel specifically. A list built from a partial set of its inputs still
 * ends with "nothing else needs attention" — and it does not know that. An alerts surface that
 * cannot see one of its sources must say so rather than quietly under-report.
 *
 * <h3>What is deliberately NOT in this list</h3>
 *
 * **Plan-limit breaches.** They are real and they are measurable — `GET
 * /platform/tenants/{id}/subscription/limits` returns a per-ceiling verdict with a four-state
 * `LimitState` — but only **one tenant at a time**. There is no cross-tenant limits endpoint, and
 * the dimensions behind it are one internal HTTP call per tenant each, so a fleet-wide sweep from
 * a landing page would be a fan-out per tenant per dimension. Rather than approximate it, the card
 * says where the answer lives. An alert that fires on a guess is worse than one that does not
 * fire.
 */

type AlertKind = "provisioning" | "commercial" | "service";

interface ConsoleAlert {
  id: string;
  kind: AlertKind;
  tone: ActivityTone;
  /** The visible severity word. Never `sr-only` — hue may not travel alone (D-38-13, §4.2). */
  toneLabel: string;
  icon: React.ReactNode;
  /** Promoted to full brightness inside the sentence: the noun the reader is hunting for. */
  subject: string;
  detail: string;
  timeLabel: string;
  dateTime?: string;
  href?: string;
}

/** danger before warning before everything else; ties keep the order they were produced in. */
const TONE_RANK: Partial<Record<ActivityTone, number>> = { danger: 0, warning: 1, info: 2 };

function rank(tone: ActivityTone): number {
  return TONE_RANK[tone] ?? 3;
}

/**
 * A tenant is "stuck" when it is still PROVISIONING well after it was created.
 *
 * <p>Fifteen minutes, and the number is a judgement rather than a measurement — nothing in this
 * product records how long provisioning is supposed to take. It is stated here rather than hidden
 * so that a reader who thinks it is wrong knows where to change it, and it is generous enough that
 * a tenant created a moment ago never appears.
 */
const PROVISIONING_STALL_MS = 15 * 60 * 1000;

/** Beyond this a trial is not news yet. Also a judgement, also stated rather than buried. */
const TRIAL_HORIZON_MS = 21 * 24 * 60 * 60 * 1000;

/** Day precision. A trial end or a period end is a DATE; an hour on it implies a promise. */
const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/** How many rows one source may contribute before the rest are summarised. */
const PER_SOURCE_CAP = 5;

function tenantAlerts(tenants: PlatformTenant[], now: number): ConsoleAlert[] {
  const out: ConsoleAlert[] = [];

  for (const tenant of tenants.filter((t) => t.status === "PROVISIONING_FAILED")) {
    out.push({
      id: `failed-${tenant.id}`,
      kind: "provisioning",
      tone: "danger",
      toneLabel: "Blocked",
      icon: <AlertTriangle />,
      subject: tenant.brandName,
      detail:
        "provisioning did not complete. This tenant has no working administrator account until it is re-driven.",
      timeLabel: readElapsed(tenant.createdAt, now).long,
      dateTime: tenant.createdAt.toISOString(),
      href: `/platform/tenants/${tenant.id}`,
    });
  }

  for (const tenant of tenants.filter(
    (t) => t.status === "PROVISIONING" && now - t.createdAt.getTime() > PROVISIONING_STALL_MS,
  )) {
    out.push({
      id: `stalled-${tenant.id}`,
      kind: "provisioning",
      tone: "warning",
      toneLabel: "Stalled",
      icon: <Loader />,
      subject: tenant.brandName,
      detail: "has been provisioning for longer than provisioning normally takes.",
      timeLabel: readElapsed(tenant.createdAt, now).long,
      dateTime: tenant.createdAt.toISOString(),
      href: `/platform/tenants/${tenant.id}`,
    });
  }

  return out;
}

function commercialAlerts(register: SubscriptionRegister, now: number): ConsoleAlert[] {
  const out: ConsoleAlert[] = [];

  for (const row of register.rows.filter((r) => r.renewalOverdue)) {
    out.push({
      id: `renewal-${row.tenantId}`,
      kind: "commercial",
      tone: "warning",
      toneLabel: "Overdue",
      icon: <CalendarClock />,
      subject: row.tenantBrandName,
      detail: `is past the end of its ${row.planName} period. Nothing rolls a period forward automatically — that would assert a payment this product never sees.`,
      timeLabel: row.currentPeriodEndAt ? formatDateTime(row.currentPeriodEndAt, DAY) : "—",
      dateTime: row.currentPeriodEndAt?.toISOString(),
      href: `/platform/tenants/${row.tenantId}`,
    });
  }

  for (const row of register.rows.filter((r) => r.status === "TRIAL_ENDED")) {
    out.push({
      id: `trial-ended-${row.tenantId}`,
      kind: "commercial",
      tone: "warning",
      toneLabel: "Decide",
      icon: <Hourglass />,
      subject: row.tenantBrandName,
      detail: `has finished its ${row.planName} trial. Its entitlements are unchanged and will stay unchanged until somebody chooses.`,
      timeLabel: row.trialEndAt ? formatDateTime(row.trialEndAt, DAY) : "—",
      dateTime: row.trialEndAt?.toISOString(),
      href: `/platform/tenants/${row.tenantId}`,
    });
  }

  const expiring = register.rows
    .filter(
      (r) =>
        r.status === "TRIALING" &&
        r.trialEndAt !== null &&
        r.trialEndAt.getTime() - now < TRIAL_HORIZON_MS,
    )
    .sort((a, b) => (a.trialEndAt?.getTime() ?? 0) - (b.trialEndAt?.getTime() ?? 0));

  for (const row of expiring) {
    out.push({
      id: `trial-${row.tenantId}`,
      kind: "commercial",
      tone: "info",
      toneLabel: "Trial ending",
      icon: <Hourglass />,
      subject: row.tenantBrandName,
      detail: `is on the ${row.planName} trial.`,
      timeLabel: row.trialEndAt ? formatDateTime(row.trialEndAt, DAY) : "—",
      dateTime: row.trialEndAt?.toISOString(),
      href: `/platform/tenants/${row.tenantId}`,
    });
  }

  return out;
}

function healthAlerts(health: SystemHealth, now: number): ConsoleAlert[] {
  const out: ConsoleAlert[] = [];
  const at = readElapsed(health.checkedAt, now).long;
  const iso = health.checkedAt.toISOString();

  for (const service of health.services) {
    if (service.state === "UP" || service.state === "UNKNOWN") continue;
    out.push({
      id: `svc-${service.serviceId}`,
      kind: "service",
      tone: service.state === "DOWN" ? "danger" : "warning",
      toneLabel: service.state === "DOWN" ? "Down" : "Unreachable",
      icon: <ServerCrash />,
      subject: service.serviceId,
      detail:
        service.state === "DOWN"
          ? `answered its health probe and reported itself unhealthy (${formatNumber(service.instancesDown)} of ${formatNumber(service.instancesRegistered)} instances).`
          : `has ${formatNumber(service.instancesRegistered)} registered instances and none of them answered. That is consistent with the process being dead AND with a network partition.`,
      timeLabel: at,
      dateTime: iso,
    });
  }

  for (const component of health.infrastructure) {
    if (component.state === "UP" || component.state === "UNKNOWN") continue;
    out.push({
      id: `infra-${component.name}`,
      kind: "service",
      tone: component.state === "DOWN" ? "danger" : "warning",
      toneLabel: component.state === "DOWN" ? "Down" : "Unreachable",
      icon: <PlugZap />,
      subject: component.name,
      detail: component.detail ?? `${component.kind.toLowerCase()} is not healthy.`,
      timeLabel: at,
      dateTime: iso,
    });
  }

  for (const migration of health.migrations) {
    if (migration.state === "UP") continue;
    out.push({
      id: `migration-${migration.name}`,
      kind: "service",
      tone: migration.state === "DOWN" ? "danger" : "warning",
      toneLabel: migration.state === "DOWN" ? "Failed" : "Unverified",
      icon: <ServerCrash />,
      subject: migration.name,
      // The BASIS is on the row deliberately: the ClickHouse precondition is INFERRED from
      // reporting-service booting rather than observed, and an alert that hid that would be
      // claiming a measurement nobody made.
      detail: `${migration.detail ?? "is not in a known-good state"} — established by: ${migration.basis}`,
      timeLabel: at,
      dateTime: iso,
    });
  }

  return out;
}

/** Trim one source's rows to the cap and report what was left out. */
function capped(alerts: ConsoleAlert[], kind: AlertKind): { rows: ConsoleAlert[]; hidden: number } {
  const mine = alerts.filter((a) => a.kind === kind);
  return { rows: mine.slice(0, PER_SOURCE_CAP), hidden: Math.max(0, mine.length - PER_SOURCE_CAP) };
}

export function OverviewAlerts() {
  const tenants = usePlatformTenants();
  const register = usePlatformSubscriptionRegister();
  const health = usePlatformSystemHealth();
  const now = useWallClock();

  const alerts = React.useMemo<ConsoleAlert[]>(() => {
    if (!tenants.data || !register.data || !health.data) return [];
    return [
      ...tenantAlerts(tenants.data, now),
      ...commercialAlerts(register.data, now),
      ...healthAlerts(health.data, now),
    ].sort((a, b) => rank(a.tone) - rank(b.tone));
  }, [tenants.data, register.data, health.data, now]);

  const provisioning = capped(alerts, "provisioning");
  const commercial = capped(alerts, "commercial");
  const service = capped(alerts, "service");
  const rows = [...provisioning.rows, ...commercial.rows, ...service.rows].sort(
    (a, b) => rank(a.tone) - rank(b.tone),
  );
  const hidden = provisioning.hidden + commercial.hidden + service.hidden;

  const resolved = Boolean(tenants.data && register.data && health.data);

  return (
    <ConsoleSection
      anchorId="platform-alerts"
      eyebrow="Worklist"
      title="Needs attention"
      description="Tenants stuck in provisioning, trials and renewals awaiting a decision, and anything failing its health probe."
    >
      <QueryBoundary
        query={[tenants, register, health]}
        what="the platform alerts"
        moduleLabel="Platform"
        loading={
          <div className="flex flex-col gap-(--space-sm)">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        }
      >
        <div className="flex flex-col gap-(--space-md)">
          {resolved && rows.length === 0 ? (
            /*
              This claim is only sound because the boundary above fails as a unit: reaching here
              means all three sources answered. An empty alerts list built from a partial set of
              inputs would be the exact defect GA-001 recorded — a screen telling the reader
              everything is fine while a service is down.
            */
            <p className="flex items-center gap-2 text-small text-foreground-secondary">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              Nothing needs attention. All three sources — tenants, subscriptions and the health
              probe — answered.
            </p>
          ) : null}

          {rows.length > 0 ? (
            <ActivityFeed label="Platform alerts">
              {rows.map((alert) => (
                <ActivityRow
                  key={alert.id}
                  icon={alert.icon}
                  tone={alert.tone}
                  toneLabel={alert.toneLabel}
                  timeLabel={alert.timeLabel}
                  dateTime={alert.dateTime}
                  href={alert.href}
                >
                  <ActivitySubject>{alert.subject}</ActivitySubject> {alert.detail}
                </ActivityRow>
              ))}
            </ActivityFeed>
          ) : null}

          {hidden > 0 ? (
            <p className="text-small text-foreground-tertiary">
              {formatNumber(hidden)} further alerts are not shown here. The tenant list and the
              subscription register hold the complete sets.
            </p>
          ) : null}

          {/*
            The stated absence. Named rather than omitted, because an omitted alert class reads as
            "there are none" and invites the next author to add one computed from a guess.
          */}
          <ConsoleNote>
            Plan-limit breaches are not in this list. The limit check is one request per tenant (
            <span className="font-mono">
              GET /platform/tenants/&#123;id&#125;/subscription/limits
            </span>
            ) and no cross-tenant endpoint exists, so a fleet sweep from this page would be a
            fan-out per tenant per dimension. Open a tenant to see its ceilings measured against its
            usage.
          </ConsoleNote>
        </div>
      </QueryBoundary>
    </ConsoleSection>
  );
}

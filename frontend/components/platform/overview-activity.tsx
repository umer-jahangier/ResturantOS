"use client";

import * as React from "react";
import { Building2, UserRoundCog } from "lucide-react";

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
import { usePlatformImpersonations } from "@/lib/hooks/use-platform-impersonations";
import type { ImpersonationRecord, PlatformTenant } from "@/lib/models/platform.model";

/**
 * Recent platform activity — both of the events this product actually publishes.
 *
 * <h3>Why the feed is short, and why that is stated on the card</h3>
 *
 * A control plane's activity stream is only as rich as the events the platform records, and this
 * one records **two**: a tenant being provisioned (`tenants.created_at`, written once and never
 * rewritten) and an impersonation session starting (`impersonation_log`, written in the same
 * transaction that mints the token). That is it.
 *
 * <p>Suspend, reactivate, cancel and close publish **no event at all** — each overwrites a single
 * nullable timestamp column on the tenant row, so only the most recent transition of each kind is
 * recoverable and a tenant suspended twice is indistinguishable from one suspended once. The
 * backend says so in its own words on the `tenant_lifecycle_timeline` figure, and it is the reason
 * this feed does not carry them: a row saying "suspended 3 days ago" would silently be a lower
 * bound presented as a history.
 *
 * <p>Stating that on the card rather than quietly shipping two event types is the point. A short
 * feed with a reason is a feed a reader can trust; a short feed with no reason is one they assume
 * is broken, and the next author "fixes" it by inventing rows.
 *
 * <h3>Tones here are CATEGORICAL, never severity</h3>
 *
 * Neither event is good news or bad news. `secondary` and `accent` are the two tones with no
 * default severity word — D-38-12 is explicit that the teal ramp "MUST NOT carry state meaning" —
 * so each supplies its own word naming the KIND of event. A green "Completed" on a provisioning
 * row and a red anything on an impersonation row would both be editorial.
 */

interface FeedEvent {
  id: string;
  tone: ActivityTone;
  toneLabel: string;
  icon: React.ReactNode;
  subject: string;
  detail: string;
  at: Date;
  href?: string;
}

/** How many rows the card shows. A landing page is a glance, not the log. */
const FEED_SIZE = 8;

function provisioningEvents(tenants: PlatformTenant[]): FeedEvent[] {
  return tenants
    .filter((tenant) => tenant.status !== "PURGED")
    .map((tenant) => ({
      id: `provisioned-${tenant.id}`,
      tone: "secondary" as const,
      toneLabel: "Provisioned",
      icon: <Building2 />,
      subject: tenant.brandName,
      detail: `was provisioned on the ${tenant.tier.toLowerCase()} tier.`,
      at: tenant.createdAt,
      href: `/platform/tenants/${tenant.id}`,
    }));
}

function impersonationEvents(records: ImpersonationRecord[]): FeedEvent[] {
  return records.map((record) => ({
    id: `impersonation-${record.id}`,
    tone: "accent" as const,
    toneLabel: "Impersonation",
    icon: <UserRoundCog />,
    // `adminEmail` is null when that platform account has since been deleted — the id still names
    // it, and the record is immutable, so the row says who it was rather than pretending nobody
    // did it.
    subject: record.adminEmail ?? "A deleted platform account",
    detail: `started a session in ${record.tenantBrandName ?? record.tenantSlug ?? "a tenant that no longer exists"}.`,
    at: record.startedAt,
    href: record.tenantId ? `/platform/tenants/${record.tenantId}` : undefined,
  }));
}

export function OverviewActivity() {
  const tenants = usePlatformTenants();
  const impersonations = usePlatformImpersonations();
  const now = useWallClock();

  const events = React.useMemo<FeedEvent[]>(() => {
    if (!tenants.data || !impersonations.data) return [];
    return [
      ...provisioningEvents(tenants.data),
      ...impersonationEvents(impersonations.data.records),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, FEED_SIZE);
  }, [tenants.data, impersonations.data]);

  const resolved = Boolean(tenants.data && impersonations.data);

  return (
    <ConsoleSection
      anchorId="platform-activity"
      eyebrow="Audit"
      title="Recent platform activity"
      description="Both of the events this product publishes."
    >
      <QueryBoundary
        query={[tenants, impersonations]}
        what="recent platform activity"
        moduleLabel="Platform"
        loading={
          <div className="flex flex-col gap-(--space-sm)">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        }
      >
        <div className="flex flex-col gap-(--space-md)">
          {resolved && events.length === 0 ? (
            <p className="text-small text-foreground-secondary">
              Nothing yet. No tenant has been provisioned and no impersonation session has been
              started.
            </p>
          ) : null}

          {events.length > 0 ? (
            <ActivityFeed label="Recent platform activity">
              {events.map((event) => (
                <ActivityRow
                  key={event.id}
                  icon={event.icon}
                  tone={event.tone}
                  toneLabel={event.toneLabel}
                  // Formatted by the caller from a single clock reading taken at mount — never
                  // from `Date.now()` during render, which renders one string on the server and
                  // another in the browser and reconciles as a text mismatch.
                  timeLabel={readElapsed(event.at, now).long}
                  dateTime={event.at.toISOString()}
                  href={event.href}
                >
                  <ActivitySubject>{event.subject}</ActivitySubject> {event.detail}
                </ActivityRow>
              ))}
            </ActivityFeed>
          ) : null}

          <ConsoleNote>
            These are the only two events the platform publishes. Suspend, reactivate, cancel and
            close overwrite a single timestamp column and emit nothing, so no per-tenant transition
            history exists to show here.
          </ConsoleNote>
        </div>
      </QueryBoundary>
    </ConsoleSection>
  );
}

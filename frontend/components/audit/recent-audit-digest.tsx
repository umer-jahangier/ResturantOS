"use client";

import * as React from "react";

import { AuditDigest } from "@/components/audit/audit-digest";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditEvents, useBranchTimeZone } from "@/lib/hooks/audit/use-audit-log";

/**
 * {@link AuditDigest} wired to the endpoint — the container half, kept in its own file.
 *
 * <p>The split is the rule this phase works to: a component takes plain props and does not fetch,
 * so `AuditDigest` can be rendered from a test, a story or a screen that already holds the rows,
 * and only this file knows there is an API. It is the same division `audit-log.tsx` did NOT make,
 * which is why the full log cannot be rendered anywhere without a query client.
 *
 * <h3>Error before empty, on the one screen where the difference is worst</h3>
 *
 * <p>Via {@link QueryBoundary}. An audit digest that renders "no events recorded" because the read
 * 403'd or the service is down is the product asserting that nothing happened — the exact
 * inverse of what a compliance record is for, and the reason `audit-log.tsx` lists this as the
 * first of its four required properties.
 *
 * <h3>The clock is the fetch instant, not the render instant</h3>
 *
 * <p>`now` is derived from React Query's `dataUpdatedAt`. Two things fall out of that and both
 * are wanted. It is honest — "4 min ago" is relative to when these rows were READ, and a tab left
 * open for an hour does not quietly age its labels against rows it has not re-read. And it is
 * hydration-safe: the value changes only when a fetch resolves, which happens in the browser, so
 * there is no server-rendered clock for the client to disagree with.
 *
 * <h3>Held until the branch zone is known</h3>
 *
 * <p>Same gate as the full log. The digest asks for no date window, so the day boundary does not
 * bite here — but `zone` still decides the absolute stamp past the 30-day bound, and firing the
 * query before the branch resolves would read one zone and then re-read another.
 */
export interface RecentAuditDigestProps {
  /** Rows requested AND rendered. The demo's digest is five. */
  limit?: number;
  /** Where the full record lives. Defaults to the audit screen. */
  href?: string;
  title?: string;
  className?: string;
}

export function RecentAuditDigest({
  limit = 5,
  href = "/app/settings/audit",
  title,
  className,
}: RecentAuditDigestProps) {
  const { zone, isLoading: zoneLoading } = useBranchTimeZone();

  const filters = React.useMemo(
    () => ({ zone: zone ?? undefined, page: 0, size: limit }),
    [zone, limit],
  );
  const eventsQuery = useAuditEvents(filters, { enabled: !zoneLoading });

  const events = React.useMemo(() => eventsQuery.data?.data ?? [], [eventsQuery.data]);
  const updatedAt = eventsQuery.dataUpdatedAt;
  const now = React.useMemo(() => new Date(updatedAt || 0), [updatedAt]);

  return (
    <QueryBoundary
      query={eventsQuery}
      what="the latest activity in this business"
      moduleLabel="Audit log"
      loading={<Skeleton className="h-64" />}
      className={className}
    >
      <AuditDigest
        events={events}
        now={now}
        limit={limit}
        timeZone={zone}
        href={href}
        title={title}
        className={className}
      />
    </QueryBoundary>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { FileClock, Lock, X } from "lucide-react";

import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePlatformOperatorAudit } from "@/lib/hooks/use-platform-operator-audit";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import { operatorActionLabel, type OperatorAuditRecord } from "@/lib/models/platform.model";

/**
 * What platform operators have done to tenant accounts — the accountability trail for the
 * principal this console belongs to.
 *
 * <h3>Why this is a different trail from the one above it, and not a duplicate</h3>
 *
 * `audit_events` is per-tenant with FORCE row-level security. *"Where has operator X been?"* is
 * therefore one query and one token PER TENANT there, it misses any tenant whose outbox delivery
 * failed, and for two of the recorded platform actions — unlock and revoke-sessions — there is no
 * tenant-side event at all. `platform_admin_audit` answers it in one indexed read of the row
 * written in the SAME TRANSACTION as the action it records, by the service that performed it.
 *
 * <p>So the two feeds are not two views of one thing: this one survives an outbox failure and the
 * other one covers what tenants do to themselves. Both are on this screen because a security
 * review needs both, and neither is derived from the other.
 *
 * <h3>Refusals are shown, and that is the point of showing outcomes at all</h3>
 *
 * An operator repeatedly attempting something they are refused is exactly the pattern an abuse
 * review looks for, and a feed of successes cannot show it. `outcome` is rendered as its own
 * column with its own badge rather than folded into the action label.
 *
 * <h3>The reason column is never empty-looking</h3>
 *
 * Every platform lifecycle call takes a mandatory `{"reason": "…"}`, which is the entire argument
 * for those endpoints demanding one. A row whose reason is null is therefore a finding, not a
 * blank — so it renders as words rather than as an em dash.
 *
 * <h3>No credential ever appears here</h3>
 *
 * The platform password reset hands a temporary password to the operator once and it exists
 * nowhere else. `platform_admin_audit` has no column that could hold one and the response has no
 * field for it. Nothing on this screen could render one if it tried.
 */

const STAMP: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * Outcome → badge. `SUCCESS` is the only one that may read as settled.
 *
 * <p>An unrecognised outcome renders its own code in the neutral variant rather than being
 * dropped or coerced to success. The enum is the backend's and it may grow; a lookup miss on an
 * accountability screen must never resolve to the reassuring member.
 */
function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (outcome === null) {
    return <StatusBadge status="inactive" label="Not recorded" />;
  }
  if (outcome === "SUCCESS") return <StatusBadge status="success" label="Succeeded" />;
  if (outcome === "REFUSED" || outcome === "DENIED") {
    return <StatusBadge status="error" label="Refused" />;
  }
  if (outcome === "FAILED" || outcome === "FAILURE") {
    return <StatusBadge status="error" label="Failed" />;
  }
  return <StatusBadge status="inactive" label={outcome} />;
}

export function OperatorAuditFeed() {
  const [tenantId, setTenantId] = React.useState("");
  const [platformUserId, setPlatformUserId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(0);

  const tenants = usePlatformTenants();

  const query = usePlatformOperatorAudit({
    tenantId: tenantId || undefined,
    platformUserId: platformUserId || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
  });
  const data = query.data;
  const records = data?.records ?? [];

  const clearAll = React.useCallback(() => {
    setTenantId("");
    setPlatformUserId("");
    setFrom("");
    setTo("");
    setPage(0);
  }, []);

  const tenantOptions = React.useMemo(
    () => (tenants.data ?? []).map((t) => ({ value: t.id, label: t.brandName || t.slug })),
    [tenants.data],
  );

  const columns = React.useMemo<ColumnDef<OperatorAuditRecord, unknown>[]>(
    () => [
      {
        id: "occurredAt",
        header: "When",
        enableSorting: false,
        meta: { mono: true },
        cell: ({ row }) => formatDateTime(row.original.occurredAt, STAMP),
      },
      {
        id: "operator",
        header: "Operator",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.platformUserId === null ? (
            <span className="text-foreground-tertiary">No operator recorded</span>
          ) : (
            <button
              type="button"
              className="text-left font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setPlatformUserId(row.original.platformUserId!);
                setPage(0);
              }}
              data-testid={`operator-filter-${row.original.platformUserId}`}
              title="Show everywhere this operator has been"
            >
              {/* The email stored AT WRITE TIME, so a rotated or renamed credential cannot rewrite
                  its own history. A deleted account degrades to the id, never to a blank. */}
              {row.original.platformUserEmail ?? `Deleted account ${row.original.platformUserId}`}
            </button>
          ),
      },
      {
        id: "action",
        header: "Action",
        enableSorting: false,
        cell: ({ row }) => operatorActionLabel(row.original.action),
      },
      {
        id: "outcome",
        header: "Outcome",
        enableSorting: false,
        cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
      },
      {
        id: "tenant",
        header: "Tenant",
        enableSorting: false,
        meta: { hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.tenantId === null ? (
            <span className="text-foreground-tertiary">Not tenant-scoped</span>
          ) : row.original.tenantSlug === null ? (
            <span className="font-mono text-label tabular-nums text-foreground-tertiary">
              {row.original.tenantId}
            </span>
          ) : (
            <Link
              href={`/platform/tenants/${row.original.tenantId}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {row.original.tenantSlug}
            </Link>
          ),
      },
      {
        id: "targetUserId",
        header: "Target user",
        enableSorting: false,
        meta: { mono: true, hideBelow: "xl" },
        cell: ({ row }) =>
          row.original.targetUserId ?? (
            <span className="text-foreground-tertiary">No target user</span>
          ),
      },
      {
        id: "reason",
        header: "Stated reason",
        enableSorting: false,
        meta: { hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.reason ?? (
            // A finding, not a blank. Every lifecycle call on this console demands a reason, so a
            // row without one is a row that got past the thing that was supposed to require it.
            <span className="font-medium text-warning">No reason recorded</span>
          ),
      },
    ],
    [],
  );

  const size = 25;
  const hasNext = data ? data.nextPage !== null : false;
  const activeCount = (tenantId ? 1 : 0) + (platformUserId ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  return (
    <ConsoleSection
      anchorId="platform-operator-audit"
      eyebrow="Read-only"
      title="Operator actions"
      description={
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          Append-only at the trigger layer, so this reader cannot be shown a rewritten history — the
          property that makes reading it worth anything.
        </span>
      }
      data-testid="operator-audit"
    >
      <div className="flex flex-col gap-(--space-md)">
        <FilterBar
          variant="bare"
          filters={[
            {
              id: "operator-tenant",
              label: "Tenant",
              value: tenantId,
              onChange: (value) => {
                setTenantId(value);
                setPage(0);
              },
              options: tenantOptions,
              isLoading: tenants.isLoading,
              error: tenants.isError,
              onRetry: () => void tenants.refetch(),
              testId: "operator-filter-tenant",
            },
          ]}
          extraActiveCount={activeCount - (tenantId ? 1 : 0)}
          onClearAll={clearAll}
        >
          <div className="flex flex-wrap items-end gap-(--space-sm)">
            <div className="flex flex-col gap-1">
              <Label htmlFor="operator-from" className="text-label text-foreground-tertiary">
                From
              </Label>
              <Input
                id="operator-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(0);
                }}
                className="w-40"
                data-testid="operator-filter-from"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="operator-to" className="text-label text-foreground-tertiary">
                To
              </Label>
              <Input
                id="operator-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(0);
                }}
                className="w-40"
                data-testid="operator-filter-to"
              />
            </div>

            {platformUserId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPlatformUserId("");
                  setPage(0);
                }}
                data-testid="operator-clear-operator"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="font-mono">{platformUserId}</span>
              </Button>
            )}
          </div>
        </FilterBar>

        {/*
          `isEmpty` IS wired to the row count here, unlike the audit trail above — and the
          difference is not an inconsistency.

          `platform_admin_audit` lives in `platform_db`, is read by the service that owns it, and
          carries no row-level-security policy this reader could fall outside of. An empty result
          means the table is empty, which on a console whose lifecycle actions all write here means
          nobody has taken one. There is no silent-filter failure mode to guard against.
        */}
        <QueryBoundary
          query={query}
          what="the operator audit trail"
          moduleLabel="Platform"
          isEmpty={data !== undefined && records.length === 0}
          empty={
            <EmptyState
              icon={FileClock}
              title={
                activeCount > 0
                  ? "No operator actions match these filters"
                  : "No platform operator has acted on a tenant account"
              }
              description={
                activeCount > 0
                  ? "Widen or clear the filters to see more. This table is in platform_db and is read directly, so an empty result here means the rows are genuinely absent."
                  : "Every deactivation, unlock, session revoke and password reset performed from this console writes a row here, with the reason its API demanded."
              }
              action={activeCount > 0 ? { label: "Clear all", onClick: clearAll } : undefined}
            />
          }
          loading={
            <div className="flex flex-col gap-(--space-sm)">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          }
        >
          {data ? (
            <div className="flex flex-col gap-(--space-md)">
              <ConsoleNote data-testid="operator-filter-note">
                Filters are applied in priority order by the API — operator, then tenant, then
                target user — rather than combined. Setting two narrows by the first only, so
                &ldquo;what did this operator do to that tenant&rdquo; is a question this endpoint
                answers one half of. Said here rather than offered as two controls that quietly
                ignore one another.
              </ConsoleNote>

              <div data-testid="operator-grid">
                <DataGrid
                  label="Platform operator actions"
                  columns={columns}
                  data={records}
                  density="comfortable"
                  pageSize={200}
                  card={{
                    primary: (row) => operatorActionLabel(row.action),
                    secondary: (row) =>
                      [
                        row.platformUserEmail ?? row.platformUserId ?? "Unknown operator",
                        row.tenantSlug ?? "Not tenant-scoped",
                        formatDateTime(row.occurredAt, STAMP),
                      ].join(" · "),
                    trailing: (row) => <OutcomeBadge outcome={row.outcome} />,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
                <p className="text-small text-foreground-tertiary" data-testid="operator-count">
                  {formatNumber(data.totalCount)} action{data.totalCount === 1 ? "" : "s"} recorded
                  {records.length < data.totalCount
                    ? ` · showing ${formatNumber(page * size + 1)}–${formatNumber(page * size + records.length)}`
                    : ""}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                    data-testid="operator-prev"
                  >
                    Previous
                  </Button>
                  {/* Driven by `nextPage` from the response envelope, never by "did this page come
                      back full?" — a full final page would otherwise offer a page that does not
                      exist, which on this screen reads as records being hidden. */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasNext}
                    onClick={() => setPage(page + 1)}
                    data-testid="operator-next"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </QueryBoundary>
      </div>
    </ConsoleSection>
  );
}

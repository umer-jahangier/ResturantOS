"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, ShieldAlert, X } from "lucide-react";

import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { AuditVerdictNotice } from "@/components/platform/audit-verdict-notice";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePlatformAuditSearch } from "@/lib/hooks/use-platform-audit";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import {
  auditActionLabel,
  auditVerdict,
  isAuthorityAction,
  isFailedLogin,
  type AuditView,
  type PlatformAuditEvent,
} from "@/lib/models/platform-audit.model";

/**
 * The platform-wide audit trail: `DataGrid` + `FilterBar`, read-only, and it looks read-only.
 *
 * <h3>What "looks read-only" means here, concretely</h3>
 *
 * There is no row action, no selection column, no bulk bar, no create affordance and no editable
 * cell anywhere in this component — not disabled ones, absent ones. That is not restraint on the
 * screen's part: `audit_events` is append-only at three independent layers (the `audit_writer`
 * role holds INSERT and SELECT and nothing else, a PostgreSQL trigger raises on UPDATE and DELETE,
 * and audit-service exposes no mutating handler on any path), so there is no endpoint a control
 * here could call. A greyed-out Delete would imply a permission the product does not have.
 *
 * <p>The one affordance the grid does offer is a FILTER: clicking an actor id narrows the feed to
 * that actor. Same device as the impersonation screen, and for the same reason — there is no
 * cross-tenant user directory to build a picker from, and a bare UUID text box is not a control
 * anybody would type into. Nothing is invented: the only actors offered are the ones already on
 * screen.
 *
 * <h3>Sorting is switched off on every column, deliberately</h3>
 *
 * `DataGrid` sorts client-side over the rows it holds, which here is ONE server page. A "sort by
 * date" that reorders fifty of five hundred rows and presents the result as the oldest event is a
 * confident wrong answer, and on this screen a reader would act on it. The server returns the
 * trail newest-first; that ordering is the one the grid shows.
 *
 * <h3>Ids are not resolved to names, and that is the honest choice</h3>
 *
 * `userId` and `impersonatedBy` are UUIDs. The platform plane holds no tenant token and resolving
 * them would be one directory call per tenant per page; a name that failed to resolve would have
 * to degrade to the id anyway, and a placeholder that reads like a person is worse than the id it
 * replaced. The TENANT is resolved, because `platform_db` holds the tenant registry itself.
 */

/** Views, in the order a security review walks them. */
export const AUDIT_VIEW_LABEL: Record<AuditView, string> = {
  events: "All events",
  logins: "Logins",
  "authority-changes": "Authority changes",
};

const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

const STAMP: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * The tenant cell.
 *
 * <p>A row can outlive its tenant registration, and when it does the slug is null. That is a real
 * state — "the tenant is gone and the record is not" — and it renders as those words beside the
 * raw id rather than as a blank cell, which would read as a missing value.
 */
function TenantCell({ event }: { event: PlatformAuditEvent }) {
  if (event.tenantId === null) {
    return <span className="text-foreground-tertiary">No tenant on this record</span>;
  }
  if (event.tenantSlug === null) {
    return (
      <span className="font-mono text-label tabular-nums text-foreground-tertiary">
        {event.tenantId}
      </span>
    );
  }
  return (
    <Link
      href={`/platform/tenants/${event.tenantId}`}
      className="font-medium text-primary underline-offset-2 hover:underline"
    >
      {event.tenantBrandName ?? event.tenantSlug}
    </Link>
  );
}

export function AuditTrail({ view }: { view: AuditView }) {
  const [tenantId, setTenantId] = React.useState("");
  const [action, setAction] = React.useState("");
  const [actorId, setActorId] = React.useState("");
  const [failedOnly, setFailedOnly] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(0);

  const tenants = usePlatformTenants();

  const query = usePlatformAuditSearch({
    view,
    tenantId: tenantId || undefined,
    action: action ? [action] : undefined,
    actorId: actorId || undefined,
    failedOnly: view === "logins" ? failedOnly : undefined,
    from: from || undefined,
    to: to || undefined,
    page,
  });
  const data = query.data;

  // Any filter change returns to the first page. Staying on page 3 of a narrower result set shows
  // an empty grid for a filter that matched rows, which on this screen reads as "nothing happened".
  const onFilter = React.useCallback(<T,>(set: (value: T) => void) => {
    return (value: T) => {
      set(value);
      setPage(0);
    };
  }, []);

  const clearAll = React.useCallback(() => {
    setTenantId("");
    setAction("");
    setActorId("");
    setFailedOnly(false);
    setFrom("");
    setTo("");
    setPage(0);
  }, []);

  /**
   * Whether the reader narrowed the question at all.
   *
   * <p>Load-bearing, and not a cosmetic flag: it is what `auditVerdict` uses to decide whether an
   * empty result is ordinary ("your filter matched nothing") or is the state this screen exists to
   * refuse to render calmly ("nothing at all came back and we cannot prove that is the truth").
   * The date bounds count — a window the reader chose is a filter — while the server's DEFAULT
   * window does not, because the reader did not ask for it.
   */
  const filtered = Boolean(tenantId || action || actorId || from || to || failedOnly);

  const verdict = data ? auditVerdict(data, filtered) : null;

  const windowLabel = data
    ? `${formatDateTime(data.from, DAY)} — ${formatDateTime(data.to, DAY)}`
    : "the selected window";

  const columns = React.useMemo<ColumnDef<PlatformAuditEvent, unknown>[]>(
    () => [
      {
        id: "occurredAt",
        header: "When",
        enableSorting: false,
        meta: { mono: true },
        cell: ({ row }) => formatDateTime(row.original.occurredAt, STAMP),
      },
      {
        id: "tenant",
        header: "Tenant",
        enableSorting: false,
        cell: ({ row }) => <TenantCell event={row.original} />,
      },
      {
        id: "action",
        header: "Action",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {auditActionLabel(row.original.action)}
            {isFailedLogin(row.original.action) ? (
              <StatusBadge status="error" label="Failed" />
            ) : isAuthorityAction(row.original.action) ? (
              <StatusBadge status="warning" label="Authority" />
            ) : null}
          </span>
        ),
      },
      {
        id: "actor",
        header: "Actor",
        enableSorting: false,
        meta: { mono: true, hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.userId === null ? (
            <span className="text-foreground-tertiary">No actor recorded</span>
          ) : (
            <button
              type="button"
              className="text-left text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setActorId(row.original.userId!);
                setPage(0);
              }}
              data-testid={`audit-filter-actor-${row.original.userId}`}
              title="Show every action by this actor"
            >
              {row.original.userId}
            </button>
          ),
      },
      {
        id: "impersonatedBy",
        header: "Under impersonation",
        enableSorting: false,
        meta: { mono: true, hideBelow: "xl" },
        cell: ({ row }) =>
          row.original.impersonatedBy === null ? (
            <span className="text-foreground-tertiary">—</span>
          ) : (
            <span
              className="flex items-center gap-1.5"
              title="A platform operator acted as this user"
            >
              <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
              {row.original.impersonatedBy}
            </span>
          ),
      },
      {
        id: "resource",
        header: "Resource",
        enableSorting: false,
        meta: { hideBelow: "xl" },
        cell: ({ row }) =>
          row.original.resourceType === null ? (
            <span className="text-foreground-tertiary">—</span>
          ) : (
            <span title={row.original.resourceId ?? undefined}>{row.original.resourceType}</span>
          ),
      },
      {
        id: "ipAddress",
        header: "Origin",
        enableSorting: false,
        meta: { mono: true, hideBelow: "xl" },
        cell: ({ row }) =>
          row.original.ipAddress ?? <span className="text-foreground-tertiary">Not recorded</span>,
      },
    ],
    [],
  );

  const actionOptions = React.useMemo(
    () =>
      (data?.actionsPresent ?? []).map((code) => ({ value: code, label: auditActionLabel(code) })),
    [data?.actionsPresent],
  );

  const tenantOptions = React.useMemo(
    () => (tenants.data ?? []).map((t) => ({ value: t.id, label: t.brandName || t.slug })),
    [tenants.data],
  );

  const events = data?.events ?? [];
  const size = data?.size ?? 50;
  /**
   * The pager, and why it is not "did this page come back full?".
   *
   * <p>When the total is COMPLETE it is the reliable signal and a full final page cannot offer a
   * next page that does not exist. When at least one tenant failed to read, the total is a LOWER
   * BOUND — using it would hide pages that exist — so the full-page heuristic is the only signal
   * left, and it is used only in that case and only because the alternative is worse.
   */
  const hasNext = data
    ? data.totalCountComplete
      ? (data.page + 1) * size < data.totalCount
      : events.length === size
    : false;

  return (
    <ConsoleSection
      anchorId="platform-audit-trail"
      eyebrow="Read-only"
      title={AUDIT_VIEW_LABEL[view]}
      description={
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          Append-only at the database. Nothing on this screen can edit, redact or delete a row —
          including the operators it names.
        </span>
      }
      data-testid="audit-trail"
    >
      <div className="flex flex-col gap-(--space-md)">
        <FilterBar
          variant="bare"
          filters={[
            {
              id: "tenant",
              label: "Tenant",
              value: tenantId,
              onChange: onFilter(setTenantId),
              options: tenantOptions,
              isLoading: tenants.isLoading,
              // An options list that FAILED must not render as an empty dropdown — an empty
              // dropdown says "there are no tenants", which is a different and far more damaging
              // statement than "this did not load".
              error: tenants.isError,
              onRetry: () => void tenants.refetch(),
              testId: "audit-filter-tenant",
            },
            // Offered only on the events view, and only from the facets the server computed for
            // THIS window and scope. A dropdown that can offer a value returning no rows reads,
            // on an audit screen, as "your trail has a hole in it".
            ...(view === "events" && data?.actionsPresent !== null
              ? [
                  {
                    id: "action",
                    label: "Action",
                    value: action,
                    onChange: onFilter(setAction),
                    options: actionOptions,
                    testId: "audit-filter-action",
                  },
                ]
              : []),
          ]}
          extraActiveCount={
            (from ? 1 : 0) + (to ? 1 : 0) + (actorId ? 1 : 0) + (failedOnly ? 1 : 0)
          }
          onClearAll={clearAll}
        >
          <div className="flex flex-wrap items-end gap-(--space-sm)">
            <div className="flex flex-col gap-1">
              <Label htmlFor="audit-from" className="text-label text-foreground-tertiary">
                From
              </Label>
              <Input
                id="audit-from"
                type="date"
                value={from}
                onChange={(e) => onFilter(setFrom)(e.target.value)}
                className="w-40"
                data-testid="audit-filter-from"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="audit-to" className="text-label text-foreground-tertiary">
                To
              </Label>
              <Input
                id="audit-to"
                type="date"
                value={to}
                onChange={(e) => onFilter(setTo)(e.target.value)}
                className="w-40"
                data-testid="audit-filter-to"
              />
            </div>

            {view === "logins" && (
              <label className="flex items-center gap-2 pb-1.5 text-small">
                <input
                  type="checkbox"
                  className="size-4 rounded-sm border-input"
                  checked={failedOnly}
                  onChange={(e) => onFilter(setFailedOnly)(e.target.checked)}
                  data-testid="audit-filter-failed-only"
                />
                Failed attempts only
              </label>
            )}

            {actorId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFilter(setActorId)("")}
                data-testid="audit-clear-actor"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="font-mono">{actorId}</span>
              </Button>
            )}
          </div>
        </FilterBar>

        {/*
          The boundary's `isEmpty` is deliberately NOT wired to `events.length === 0`.

          That is the whole point of this screen: an empty list is not a fact about activity here,
          and `EmptyState`'s calm "nothing found" is the exact rendering GA-001 describes. The
          verdict below decides which of five different sentences is true, and one of them is a
          warning rather than an empty state.
        */}
        <QueryBoundary
          query={query}
          what="the platform audit trail"
          moduleLabel="Audit"
          stillWorks="Tenant, subscription and system screens read different services and are unaffected by this."
          loading={
            <div className="flex flex-col gap-(--space-sm)">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          }
        >
          {data && verdict ? (
            <div className="flex flex-col gap-(--space-md)">
              <AuditVerdictNotice
                verdict={verdict}
                windowLabel={windowLabel}
                onClearFilters={clearAll}
              />

              {events.length > 0 && (
                <>
                  {data.scanTruncated && (
                    <ConsoleNote tone="warning" data-testid="audit-scan-truncated">
                      This page is deeper than the per-tenant scan budget, so the cross-tenant merge
                      can no longer be proven exact. Narrow the window or the tenant rather than
                      paging further.
                    </ConsoleNote>
                  )}

                  <div data-testid="audit-grid">
                    <DataGrid
                      label={`${AUDIT_VIEW_LABEL[view]} across every tenant`}
                      columns={columns}
                      data={events}
                      density="comfortable"
                      // One SERVER page per grid. `pageSize` is set above the page size so the
                      // grid's own client pager stays hidden — two pagers over one list would let
                      // a reader page inside page 1 and believe they had reached the end.
                      pageSize={200}
                      card={{
                        primary: (event) => auditActionLabel(event.action),
                        secondary: (event) =>
                          [
                            event.tenantBrandName ?? event.tenantSlug ?? "Unregistered tenant",
                            formatDateTime(event.occurredAt, STAMP),
                          ].join(" · "),
                        trailing: (event) =>
                          isFailedLogin(event.action) ? (
                            <StatusBadge status="error" label="Failed" />
                          ) : isAuthorityAction(event.action) ? (
                            <StatusBadge status="warning" label="Authority" />
                          ) : null,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-(--space-sm)">
                    <p className="text-small text-foreground-tertiary" data-testid="audit-count">
                      {/*
                        "At least" is not hedging. `totalCountComplete: false` means a tenant's log
                        did not answer, so the real total is higher — and on an audit surface,
                        printing a lower bound as a fact tells the reader their history is smaller
                        than it is, which is the most damaging direction to be wrong in.
                      */}
                      {data.totalCountComplete ? "" : "At least "}
                      {formatNumber(data.totalCount)} event
                      {data.totalCount === 1 ? "" : "s"} in {windowLabel} · read{" "}
                      {formatNumber(data.tenantsRead)} of {formatNumber(data.tenantsInScope)} tenant
                      {data.tenantsInScope === 1 ? "" : "s"}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                        data-testid="audit-prev"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!hasNext}
                        onClick={() => setPage(page + 1)}
                        data-testid="audit-next"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </QueryBoundary>
      </div>
    </ConsoleSection>
  );
}

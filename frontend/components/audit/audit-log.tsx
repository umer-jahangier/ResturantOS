"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/ui/data-grid/data-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Select } from "@/components/ui/select";
import { useAuditEvents, useAuditFacets, useBranchTimeZone } from "@/lib/hooks/audit/use-audit-log";
import type { AuditEvent } from "@/lib/models/audit.model";
import { cn } from "@/lib/utils";

/**
 * The tenant's audit trail, on a screen (F4).
 *
 * <h2>What was missing, exactly</h2>
 *
 * <p>Nothing on the write side. `audit_events` had 3,457 rows for this tenant on the morning this
 * was built — every login, every void, every journal posting, every role grant — and
 * `GET /api/v1/audit/events` answered 200 for the OWNER. There was no page. `/app/audit`,
 * `/app/settings/audit`, `/app/admin/audit` and `/app/settings/security` all 404'd, and no
 * navigation entry in the product matched audit, log, activity, history or security. The one
 * question an audit log exists to answer — "who voided that check, and why" — was answerable only
 * by someone willing to write a bearer token into curl.
 *
 * <h2>Four properties this screen must have</h2>
 *
 * <p><b>It never shows an empty log it does not mean.</b> Every read goes through
 * {@link QueryBoundary}, which checks error before empty by construction. On an audit log the
 * GA-001 lie is at its most damaging: "no events match" shown to someone whose service is down
 * reads as evidence that nothing happened.
 *
 * <p><b>Times are the restaurant's, and say so.</b> Rendered in the BRANCH's stored zone, with the
 * zone named on screen. A timestamp with no stated zone next to a five-hour offset is how the
 * Takings screen came to show a day that was not the day.
 *
 * <p><b>A filter that cannot match says so before it is applied.</b> A From after a To is caught as
 * the user types, names both fields and the actual problem, and is NOT sent — because the honest
 * answer from the server would be zero rows, and zero rows on this screen reads as "your trail has
 * a hole in it".
 *
 * <p><b>The total is stated.</b> "Showing 51–100 of 3,457" — a pager with only Next teaches the
 * reader that the log ends where the first page does.
 */

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

/** `Intl` refuses an unknown zone by throwing; the caller must not take the page down with it. */
function formatInZone(instant: Date, zone: string | null): string {
  if (instant.getTime() === 0) return "—";
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone ?? undefined }).format(
      instant,
    );
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(instant);
  }
}

/** `ORDER_VOIDED` → `Order voided`. The stored name stays visible underneath; this is the label. */
function humaniseAction(action: string): string {
  const words = action.replace(/_/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Who did it, in the most specific form available.
 *
 * <p>Falls back to a short id, never to "Unknown" or a blank: the id IS the record, and the name is
 * resolved decoration that a directory outage can withhold. A blank here would read as "nobody did
 * this", which of an audit row is never true.
 */
function actorLabel(row: AuditEvent): string {
  if (row.actorName) return row.actorName;
  if (row.actorId) return `${row.actorId.slice(0, 8)}…`;
  return "Not recorded";
}

export function AuditLog() {
  const { zone, isLoading: zoneLoading } = useBranchTimeZone();

  // The controls the user is editing, kept apart from the filters actually sent. A range that runs
  // backwards is never applied, so the table always shows a window the caption can describe.
  const [draftFrom, setDraftFrom] = React.useState("");
  const [draftTo, setDraftTo] = React.useState("");
  const [action, setAction] = React.useState("");
  const [resourceType, setResourceType] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [size, setSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [openRowId, setOpenRowId] = React.useState<number | null>(null);

  const rangeIsBackwards = Boolean(draftFrom && draftTo && draftFrom > draftTo);
  const appliedFrom = rangeIsBackwards ? "" : draftFrom;
  const appliedTo = rangeIsBackwards ? "" : draftTo;

  // A filter change is a different question, so it starts at its first page. Without this, changing
  // the action while on page 7 asks for page 7 of a shorter list and lands on nothing.
  const filterSignature = `${action}|${resourceType}|${appliedFrom}|${appliedTo}|${size}`;
  const lastSignature = React.useRef(filterSignature);
  React.useEffect(() => {
    if (lastSignature.current !== filterSignature) {
      lastSignature.current = filterSignature;
      setPage(0);
      setOpenRowId(null);
    }
  }, [filterSignature]);

  const dateWindow = React.useMemo(
    () => ({
      from: appliedFrom || undefined,
      to: appliedTo || undefined,
      zone: zone ?? undefined,
    }),
    [appliedFrom, appliedTo, zone],
  );

  const filters = React.useMemo(
    () => ({
      ...dateWindow,
      action: action || undefined,
      resourceType: resourceType || undefined,
      page,
      size,
    }),
    [dateWindow, action, resourceType, page, size],
  );

  // Held until the branch zone is known — see the hook. `zoneLoading` is false when there is no
  // branch at all, so a branchless session still reads the log rather than waiting forever.
  const eventsQuery = useAuditEvents(filters, { enabled: !zoneLoading });
  const facetsQuery = useAuditFacets(dateWindow, { enabled: !zoneLoading });

  const rows = eventsQuery.data?.data ?? [];
  const total = eventsQuery.data?.meta?.totalCount ?? 0;
  const firstIndex = total === 0 ? 0 : page * size + 1;
  const lastIndex = Math.min(page * size + rows.length, total);
  const hasNext = Boolean(eventsQuery.data?.meta?.page.nextCursor);
  /** What is actually narrowing the ROWS — used for the "no rows match" copy under the table. */
  const isFiltered = Boolean(action || resourceType || appliedFrom || appliedTo);
  /**
   * What the user has TYPED, which is not the same thing.
   *
   * <p>Found by driving it: a backwards range blanks `appliedFrom`/`appliedTo` (deliberately — it
   * is never sent), and gating the Clear button on the applied values meant the one state where a
   * user most needs to clear their filters was the one state with no Clear button. The error told
   * them to move a date and gave them nothing to press.
   */
  const hasTypedFilters = Boolean(action || resourceType || draftFrom || draftTo);

  const actionOptions = React.useMemo(
    () => [
      { value: "", label: "All events" },
      ...(facetsQuery.data?.actions ?? []).map((a) => ({ value: a, label: humaniseAction(a) })),
    ],
    [facetsQuery.data],
  );
  const resourceOptions = React.useMemo(
    () => [
      { value: "", label: "Anything" },
      ...(facetsQuery.data?.resourceTypes ?? []).map((r) => ({
        value: r,
        label: humaniseAction(r),
      })),
    ],
    [facetsQuery.data],
  );

  const openRow = rows.find((r) => r.id === openRowId) ?? null;

  const columns = React.useMemo<ColumnDef<AuditEvent, unknown>[]>(
    () => [
      {
        id: "when",
        header: "When",
        cell: ({ row }) => (
          <span className="tabular-nums" data-testid={`audit-when-${row.original.id}`}>
            {formatInZone(row.original.occurredAt, zone)}
          </span>
        ),
      },
      {
        id: "event",
        header: "Event",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{humaniseAction(row.original.action)}</span>
            {/* The stored name, because a filter and a support request both use it, not the label. */}
            <span className="text-xs text-muted-foreground">{row.original.action}</span>
          </div>
        ),
      },
      {
        id: "who",
        header: "Who",
        cell: ({ row }) => (
          <div className="flex max-w-[16rem] flex-col gap-0.5">
            <span className="truncate" title={row.original.actorId ?? undefined}>
              {actorLabel(row.original)}
            </span>
            {row.original.impersonatorId && (
              // The one attribution that must never be collapsed: the account acted AS is not the
              // human who acted. D-34 recorded every user as their own impersonator.
              <span className="truncate text-xs text-amber-600 dark:text-amber-400">
                acting as this account:{" "}
                {row.original.impersonatorName ?? `${row.original.impersonatorId.slice(0, 8)}…`}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "what",
        header: "What",
        cell: ({ row }) => (
          <div className="flex max-w-[14rem] flex-col gap-0.5">
            <span>{row.original.resourceType ?? "—"}</span>
            {row.original.resourceId && (
              <span
                className="truncate text-xs text-muted-foreground"
                title={row.original.resourceId}
              >
                {row.original.resourceId}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        cell: ({ row }) => (
          <span
            className={cn(
              "block max-w-[22rem] truncate",
              !row.original.reason && "text-muted-foreground",
            )}
            title={row.original.reason ?? undefined}
          >
            {row.original.reason ?? "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <button
              type="button"
              data-testid={`audit-detail-${row.original.id}`}
              aria-expanded={openRowId === row.original.id}
              onClick={() => setOpenRowId(openRowId === row.original.id ? null : row.original.id)}
              className="text-xs font-medium text-primary underline"
            >
              {openRowId === row.original.id ? "Hide" : "Details"}
            </button>
          </div>
        ),
      },
    ],
    [zone, openRowId],
  );

  return (
    <div className="space-y-4">
      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-action">Event</Label>
            <Select
              id="audit-action"
              data-testid="audit-filter-action"
              options={actionOptions}
              value={action}
              onValueChange={setAction}
              isLoading={facetsQuery.isPending}
              error={facetsQuery.isError}
              onRetry={() => void facetsQuery.refetch()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-resource">Applies to</Label>
            <Select
              id="audit-resource"
              data-testid="audit-filter-resource"
              options={resourceOptions}
              value={resourceType}
              onValueChange={setResourceType}
              isLoading={facetsQuery.isPending}
              error={facetsQuery.isError}
              onRetry={() => void facetsQuery.refetch()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input
              id="audit-from"
              type="date"
              data-testid="audit-filter-from"
              value={draftFrom}
              aria-invalid={rangeIsBackwards || undefined}
              aria-describedby={rangeIsBackwards ? "audit-range-error" : undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input
              id="audit-to"
              type="date"
              data-testid="audit-filter-to"
              value={draftTo}
              aria-invalid={rangeIsBackwards || undefined}
              aria-describedby={rangeIsBackwards ? "audit-range-error" : undefined}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </div>
        </div>

        {rangeIsBackwards && (
          // Named fields, the real problem, and the consequence — not "invalid input". The filter
          // is deliberately NOT applied: the server's honest answer would be zero rows, and zero
          // rows here reads as a missing audit trail rather than as a mistyped date.
          <p
            id="audit-range-error"
            role="alert"
            data-testid="audit-range-error"
            className="mt-3 text-sm text-destructive"
          >
            <strong>From</strong> is {draftFrom}, which is after <strong>To</strong> ({draftTo}). No
            day can be in both, so this range has not been applied — the list below still shows the
            last range that could match. Move one of the two dates.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" data-testid="audit-zone-note">
            Times are shown in{" "}
            <strong>{zone ?? "your device's time zone"}</strong>
            {zone
              ? " — this branch's time zone. Dates you pick above are whole days in that zone."
              : " — this branch has no time zone saved, so days are cut in UTC. Set one in Settings so the log matches the shift."}
          </p>
          {hasTypedFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="audit-clear-filters"
              onClick={() => {
                setAction("");
                setResourceType("");
                setDraftFrom("");
                setDraftTo("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* ── The log ─────────────────────────────────────────────────────────── */}
      <QueryBoundary
        query={eventsQuery}
        what="the audit log"
        moduleLabel="Audit log"
        stillWorks="The till, the kitchen board and the rest of the product are unaffected — only this record is unreadable right now."
      >
        <>
          <DataGrid<AuditEvent>
            columns={columns}
            data={rows}
            density="comfortable"
            // The server already paged this; DataGrid must not page it a second time or the
            // footer would say "Page 1 of 2" inside what is itself page 4 of 70.
            pageSize={Math.max(rows.length, 1)}
            label="Audit log"
            isFiltered={isFiltered}
            onClearFilters={() => {
              setAction("");
              setResourceType("");
              setDraftFrom("");
              setDraftTo("");
            }}
            emptyTitle="Nothing has been recorded yet"
            emptyDescription="Sign-ins, voids, refunds, till sessions, role changes and journal postings all appear here as they happen."
            card={{
              primary: (row) => humaniseAction(row.action),
              secondary: (row) =>
                `${actorLabel(row)} · ${formatInZone(row.occurredAt, zone)}${
                  row.reason ? ` · ${row.reason}` : ""
                }`,
              trailing: (row) => row.resourceType ?? "—",
            }}
          />

          {/* Count and pager. The count is stated even on a single page, for the same reason
              DataGrid states its own: it is the only place a miscount is observable. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="audit-page-summary">
              {total === 0
                ? "0 events"
                : `Showing ${firstIndex.toLocaleString()}–${lastIndex.toLocaleString()} of ${total.toLocaleString()} event${
                    total === 1 ? "" : "s"
                  }`}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>Rows</span>
                <select
                  aria-label="Rows per page"
                  data-testid="audit-page-size"
                  className="h-8 rounded-md border border-border-interactive bg-transparent px-2 text-sm dark:bg-surface-2"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="audit-prev-page"
                disabled={page === 0 || eventsQuery.isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm tabular-nums" data-testid="audit-page-number">
                Page {page + 1}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="audit-next-page"
                disabled={!hasNext || eventsQuery.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>

          {/* ── One row, in full ──────────────────────────────────────────────
              Everything recorded, already redacted server-side. Shown on demand rather than in the
              table because the payloads differ per event type and a column per key would be mostly
              blank — which §23 forbids and which makes a long list unscannable. */}
          {openRow && (
            <div className="mt-3 rounded-lg border p-4" data-testid="audit-detail-panel">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{humaniseAction(openRow.action)}</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatInZone(openRow.occurredAt, zone)} · by {actorLabel(openRow)}
                    {openRow.actorId ? ` (${openRow.actorId})` : ""}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpenRowId(null)}>
                  Close
                </Button>
              </div>

              {openRow.detailsUnreadable ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  This event&apos;s recorded detail could not be read. The event itself is intact —
                  only its payload is unreadable, and it cannot be edited or removed.
                </p>
              ) : Object.keys(openRow.details).length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No further detail was recorded for this event.
                </p>
              ) : (
                <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
                  {Object.entries(openRow.details).map(([key, value]) => (
                    <React.Fragment key={key}>
                      <dt className="text-sm font-medium">{key}</dt>
                      <dd className="text-sm break-all text-muted-foreground">
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
          )}
        </>
      </QueryBoundary>

    </div>
  );
}

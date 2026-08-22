"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { DataGrid } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useAuditEvents, useAuditFacets, useBranchTimeZone } from "@/lib/hooks/audit/use-audit-log";
import type { AuditEvent } from "@/lib/models/audit.model";
import { formatNumber } from "@/lib/format/locale";
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

/**
 * The `from` the "Search all time" affordance applies — earlier than any row can be.
 *
 * <p>Not the retention period computed from today. The server detaches partitions past retention,
 * so a range reaching further back than the data simply matches what is still attached; naming an
 * early date is therefore exactly equivalent to "everything there is", without this file holding a
 * second copy of a retention constant that belongs to the server.
 */
const ALL_TIME_FROM = "2000-01-01";

/**
 * "14 May – 12 Aug 2026" — the window, as a person would write it.
 *
 * <p>The year appears on the left only when the range crosses one, so the common case stays short
 * without ever being ambiguous about which year is being read.
 *
 * <p><b>{@code en-GB}, not the viewer's locale</b> — the same pin the row timestamps use below. The
 * first version of this took the browser's default and rendered "May 14 – Aug 12, 2026" on a US
 * machine while the table three inches beneath it said "12 Aug 2026", because that formatter is
 * pinned and this one was not. Two date formats on one screen is exactly the kind of small
 * incoherence that makes a reader doubt a compliance record, and it is invisible to anyone
 * developing in the same locale as the format they forgot to pin.
 */
function formatWindow(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(d);
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
}

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

  /**
   * The one reset. Three controls used to hold three copies of this body — `FilterBar`'s clear,
   * the "Clear filters" button and `DataGrid`'s filtered-empty affordance — and a fourth filter
   * added to any one of them would have left the other two silently partial.
   */
  const clearAllFilters = React.useCallback(() => {
    setAction("");
    setResourceType("");
    setDraftFrom("");
    setDraftTo("");
  }, []);

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
            <span className="text-label text-muted-foreground">{row.original.action}</span>
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
              <span className="truncate text-label text-warning">
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
                className="truncate text-label text-muted-foreground"
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
              className="text-label font-medium text-primary underline"
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
      {/* ── Filters ─────────────────────────────────────────────────────────────
          The shared `FilterBar` (38-10 task 5 / D-38-17): this screen used to hand-roll its own
          `rounded-lg border p-4` strip with a four-column grid inside it — one of the twelve
          spellings of a filter row the primitive was written to end.

          Two things are gained that this screen could not have had on its own: a live count of
          how many filters are on, and one removable chip per active filter. Both matter more on
          an audit log than anywhere else. A narrowed log looks exactly like a short log, and an
          auditor who cannot see that a filter is on reads "3 events" as the whole record.

          The date range stays in `children` because `FilterBar` has no shape for a two-input
          range and inventing one from a call site is how a primitive grows a special case per
          screen. `extraActiveCount` is what keeps the count honest about them, and `onClearAll`
          is passed for the same reason — the default reset can only see `filters`, and a "Clear
          all" that leaves the dates on is precisely the lie the component exists to prevent. */}
      <FilterBar
        title="Filters"
        filters={[
          {
            id: "action",
            label: "Event",
            testId: "audit-filter-action",
            value: action,
            onChange: setAction,
            // `actionOptions` already carries its own "All events" head entry, because the same
            // array is the source for the chip label. FilterBar prepends `allLabel` to whatever
            // it is given, so the head entry is dropped here rather than rendered twice.
            options: actionOptions.slice(1),
            allLabel: "All events",
            isLoading: facetsQuery.isPending,
            error: facetsQuery.isError,
            onRetry: () => void facetsQuery.refetch(),
          },
          {
            id: "resource",
            label: "Applies to",
            testId: "audit-filter-resource",
            value: resourceType,
            onChange: setResourceType,
            options: resourceOptions.slice(1),
            allLabel: "Anything",
            isLoading: facetsQuery.isPending,
            error: facetsQuery.isError,
            onRetry: () => void facetsQuery.refetch(),
          },
        ]}
        extraActiveCount={(draftFrom ? 1 : 0) + (draftTo ? 1 : 0)}
        onClearAll={clearAllFilters}
      >
        <div className="flex min-w-40 flex-col gap-1">
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
        <div className="flex min-w-40 flex-col gap-1">
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
      </FilterBar>

      {/* The three notices that belong to the filter strip but not inside it: they describe what
          the strip has DONE, and a control row is the wrong place for prose. */}
      <div className="space-y-3">
        {rangeIsBackwards && (
          // Named fields, the real problem, and the consequence — not "invalid input". The filter
          // is deliberately NOT applied: the server's honest answer would be zero rows, and zero
          // rows here reads as a missing audit trail rather than as a mistyped date.
          <p
            id="audit-range-error"
            role="alert"
            data-testid="audit-range-error"
            className="text-small text-destructive"
          >
            <strong>From</strong> is {draftFrom}, which is after <strong>To</strong> ({draftTo}). No
            day can be in both, so this range has not been applied — the list below still shows the
            last range that could match. Move one of the two dates.
          </p>
        )}

        {/*
          The window this screen is reading, named in dates rather than in a relative phrase.

          The server bounds a dateless request to a recent window instead of reading the whole
          seven-year record — without this line a reader would see 90 days and conclude that IS the
          record, which is the same false impression as a filter option that returns nothing, just
          arriving by a different route. So it states the days, says the rest is still there, and
          puts widening one click away. "Retained and searchable" is the load-bearing half: it tells
          the reader nothing was deleted, only not fetched.

          Dates come from the facets response, never computed here. Working them out locally would
          put a second copy of the server's default window in this file, and the day the two drifted
          the screen would confidently name a range it had not read.
        */}
        {facetsQuery.data?.windowFrom && facetsQuery.data?.windowTo && (
          <p className="text-small text-muted-foreground" data-testid="audit-window-note">
            Showing{" "}
            <strong>{formatWindow(facetsQuery.data.windowFrom, facetsQuery.data.windowTo)}</strong>
            {!appliedFrom && !appliedTo && " (the last 90 days)"}. Older entries are retained and
            searchable.{" "}
            {draftFrom !== ALL_TIME_FROM && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 align-baseline"
                data-testid="audit-search-all-time"
                onClick={() => {
                  setDraftFrom(ALL_TIME_FROM);
                  setDraftTo("");
                }}
              >
                Search all time
              </Button>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-small text-muted-foreground" data-testid="audit-zone-note">
            Times are shown in <strong>{zone ?? "your device's time zone"}</strong>
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
              onClick={clearAllFilters}
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
            onClearFilters={clearAllFilters}
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
            <p className="text-small text-muted-foreground" data-testid="audit-page-summary">
              {total === 0
                ? "0 events"
                : `Showing ${formatNumber(firstIndex)}–${formatNumber(lastIndex)} of ${formatNumber(total)} event${
                    total === 1 ? "" : "s"
                  }`}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-small text-muted-foreground">
                <span>Rows</span>
                <select
                  aria-label="Rows per page"
                  data-testid="audit-page-size"
                  className="h-8 rounded-md border border-border-interactive bg-transparent px-2 text-small dark:bg-surface-2"
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
              <span className="text-small tabular-nums" data-testid="audit-page-number">
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
                  <h2 className="text-h2 font-semibold">{humaniseAction(openRow.action)}</h2>
                  <p className="text-small text-muted-foreground">
                    {formatInZone(openRow.occurredAt, zone)} · by {actorLabel(openRow)}
                    {openRow.actorId ? ` (${openRow.actorId})` : ""}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpenRowId(null)}>
                  Close
                </Button>
              </div>

              {openRow.detailsUnreadable ? (
                <p role="alert" className="mt-3 text-small text-destructive">
                  This event&apos;s recorded detail could not be read. The event itself is intact —
                  only its payload is unreadable, and it cannot be edited or removed.
                </p>
              ) : Object.keys(openRow.details).length === 0 ? (
                <p className="mt-3 text-small text-muted-foreground">
                  No further detail was recorded for this event.
                </p>
              ) : (
                <dl className="mt-3 grid gap-x-6 gap-y-1 md:grid-cols-[max-content_1fr]">
                  {Object.entries(openRow.details).map(([key, value]) => (
                    <React.Fragment key={key}>
                      <dt className="text-small font-medium">{key}</dt>
                      <dd className="text-small break-all text-muted-foreground">
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

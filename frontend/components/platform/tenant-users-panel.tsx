"use client";

import * as React from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useTenantUsers } from "@/lib/hooks/use-platform-tenant-users";
import {
  tenantUserStanding,
  tenantUserStandingLabel,
  type TenantUserRow,
  type TenantUserStanding,
} from "@/lib/models/platform.model";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const STANDING_STYLE: Record<TenantUserStanding, string> = {
  ACTIVE: "border-success/20 bg-success/10 text-success",
  DEACTIVATED: "border-destructive/20 bg-destructive/10 text-destructive",
  // Not a fault and not a healthy account: provisioned and never used. Distinct from both, because
  // it is the shape of a tenant that cannot get in and the one row an operator should look at.
  NEVER_SIGNED_IN: "border-warning/20 bg-warning/10 text-warning",
  MUST_CHANGE: "border-info/20 bg-info/10 text-info",
};

/**
 * The people inside one tenant, read from the platform plane.
 *
 * <h3>Why this list exists and why it is one call</h3>
 *
 * Until the per-tenant endpoint shipped there was no way for a SuperAdmin to see a tenant's users at
 * all: `auth_db.users` is FORCE row-level security on `app.current_tenant_id`, platform_db holds no
 * grant in auth_db and has neither FDW nor dblink, and a platform token carries no tenant claim, so
 * the tenant-facing user API refuses it. The fleet-wide directory solves that by fanning out one
 * HTTP call per tenant; with the tenant known this is a single call, and the answer cannot be
 * partially wrong in the way a fan-out can.
 *
 * <p>The response still carries its `scan` block and it is still rendered. When the total is
 * withheld, this panel says the total is unknown rather than counting the rows it happens to hold —
 * a number that looks complete and is not is precisely what that block exists to refuse.
 *
 * <h3>"Never signed in" is the reading worth having</h3>
 *
 * `last_login_at` is the ONLY activity signal this platform records about a person. There is no
 * session count, no last-seen and no per-user action counter anywhere, so a richer "last active"
 * would be invented. What the one timestamp CAN say is important: null means the account has never
 * been used, which is the visible form of a tenant whose administrator cannot get in — the exact
 * failure a whole blocker was written about. It is a standing of its own here, not a blank cell.
 *
 * <h3>Read-only, deliberately</h3>
 *
 * Deactivating, unlocking, revoking sessions and resetting a password are platform-tier actions on
 * ONE person: each takes a mandatory reason, each is attributed to the operator's verified token,
 * and each writes an audit row. They belong beside that person, not on a tenant summary where the
 * target of a click is a row in a list of similar rows. Nothing on this panel mutates anything.
 */
export function TenantUsersPanel({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [search, setSearch] = React.useState("");
  // Debounced would be better; the endpoint pushes the term to auth-service's own query, so every
  // keystroke is a cross-service call. It is left immediate because a tenant's user list is tens of
  // rows and a stale-while-refetch grid is the behaviour an operator expects from a search box.
  const users = useTenantUsers(tenantId, search);
  const data = users.data;

  const rows: TenantUserRow[] = React.useMemo(() => data?.users ?? [], [data]);

  const standingCounts = React.useMemo(() => {
    const counts = {
      ACTIVE: 0,
      DEACTIVATED: 0,
      NEVER_SIGNED_IN: 0,
      MUST_CHANGE: 0,
    } satisfies Record<TenantUserStanding, number>;
    for (const user of rows) counts[tenantUserStanding(user)] += 1;
    return counts;
  }, [rows]);

  const columns = React.useMemo<ColumnDef<TenantUserRow, unknown>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        accessorFn: (row) => row.fullName ?? row.email,
        cell: ({ row }) => (
          <span className="block max-w-[20rem] py-1.5">
            <span className="block truncate font-medium text-foreground">
              {row.original.fullName ?? (
                <span className="text-foreground-tertiary">No name recorded</span>
              )}
            </span>
            <span className="block truncate font-mono text-label text-foreground-tertiary">
              {row.original.email}
            </span>
          </span>
        ),
      },
      {
        id: "standing",
        header: "Standing",
        accessorFn: (row) => tenantUserStanding(row),
        cell: ({ row }) => {
          const standing = tenantUserStanding(row.original);
          return (
            <span
              data-testid={`tenant-user-standing-${standing}`}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-label font-semibold whitespace-nowrap",
                STANDING_STYLE[standing],
              )}
            >
              {tenantUserStandingLabel(standing)}
            </span>
          );
        },
      },
      {
        id: "totp",
        header: "Two-factor",
        accessorFn: (row) => (row.totpEnabled ? 1 : 0),
        meta: { hideBelow: "md" },
        cell: ({ row }) =>
          row.original.totpEnabled ? (
            <span className="inline-flex items-center gap-1 text-success">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              On
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-foreground-tertiary">
              <ShieldOff className="size-3.5 shrink-0" aria-hidden="true" />
              Off
            </span>
          ),
      },
      {
        id: "last-login",
        header: "Last sign-in",
        // Never-signed-in sorts to the top: it is the row an operator is looking for.
        accessorFn: (row) => row.lastLoginAt?.getTime() ?? 0,
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <span className="whitespace-nowrap">
              {formatDateTime(row.original.lastLoginAt, DATE_ONLY)}
            </span>
          ) : (
            <span className="whitespace-nowrap text-warning">Never</span>
          ),
      },
      {
        id: "created",
        header: "Added",
        accessorFn: (row) => row.createdAt.getTime(),
        meta: { hideBelow: "lg" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDateTime(row.original.createdAt, DATE_ONLY)}
          </span>
        ),
      },
      {
        id: "id",
        header: "User id",
        accessorFn: (row) => row.userId,
        meta: { mono: true, hideBelow: "xl" },
        cell: ({ row }) => (
          <span className="text-foreground-tertiary">{row.original.userId.slice(0, 8)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <ConsoleSection
      anchorId="users"
      eyebrow="People"
      title="Users in this tenant"
      description={`Every account inside ${tenantName}, and whether it can actually be signed in to.`}
      data-testid="tenant-users"
    >
      <div className="flex flex-col gap-(--space-md)">
        <FilterBar
          variant="bare"
          search={{
            value: search,
            onChange: setSearch,
            label: "Search this tenant's users by name or email",
            placeholder: "Name or email…",
          }}
        />

        <QueryBoundary
          query={users}
          what="this tenant's users"
          loading={<DataTableSkeleton columns={5} />}
          isEmpty={Boolean(data) && rows.length === 0 && search.trim() === ""}
          empty={
            <ConsoleNote tone="warning" data-testid="tenant-users-empty">
              This tenant has no user accounts at all. That is not a normal state — provisioning
              creates a first administrator — so it usually means the provisioning saga did not
              finish. The lifecycle panel above can re-drive it.
            </ConsoleNote>
          }
        >
          {data ? (
            <div className="flex flex-col gap-(--space-sm)">
              {/*
                The provenance block. For a single tenant an unreachable entry means auth-service did
                not answer for THIS restaurant — so the grid is empty for a reason that has nothing
                to do with the tenant having no staff, and the two must never look the same.
              */}
              {data.scan.unreachable.length > 0 && (
                <ConsoleNote tone="warning" role="alert" data-testid="tenant-users-unreachable">
                  This tenant&apos;s user records could not be read on this request
                  {data.scan.unreachable[0]?.detail
                    ? `: ${data.scan.unreachable[0].detail}`
                    : "."}{" "}
                  The list below is incomplete and its total is unknown — this is a read failure,
                  not a tenant without staff.
                </ConsoleNote>
              )}

              {/*
                The breakdown is counted from the rows on screen, so it is only allowed to describe
                the total when the total IS the rows on screen. A page that is a prefix of a larger
                answer gets the count and the prefix stated separately — four standing figures
                presented as a breakdown of a number they do not add up to is the same class of
                error as a fabricated figure, and harder to notice.
              */}
              <p className="text-small text-foreground-secondary" data-testid="tenant-users-count">
                <span className="font-medium text-foreground">
                  {data.scan.totalCount === null
                    ? "Total unknown"
                    : `${formatNumber(data.scan.totalCount)} user${data.scan.totalCount === 1 ? "" : "s"}`}
                </span>
                {data.scan.totalCount === null ? (
                  <span>
                    {" — "}
                    {data.scan.totalCountNote ??
                      "this tenant's user records could not be counted on this request."}
                  </span>
                ) : data.scan.totalCount !== rows.length ? (
                  <span>
                    {`, of which ${formatNumber(rows.length)} are listed here. Filter or search to narrow the page before reading a breakdown.`}
                  </span>
                ) : (
                  <>
                    {": "}
                    {formatNumber(standingCounts.ACTIVE)} active ·{" "}
                    {formatNumber(standingCounts.MUST_CHANGE)} owe a password change ·{" "}
                    {formatNumber(standingCounts.NEVER_SIGNED_IN)} never signed in ·{" "}
                    {formatNumber(standingCounts.DEACTIVATED)} deactivated.
                  </>
                )}
              </p>

              <DataGrid
                columns={columns}
                data={rows}
                label={`Users in ${tenantName}`}
                isFiltered={search.trim() !== ""}
                onClearFilters={() => setSearch("")}
                emptyTitle="No user accounts"
                emptyDescription="Provisioning creates a first administrator, so an empty list usually means provisioning did not finish."
                card={{
                  primary: (row) => row.fullName ?? row.email,
                  secondary: (row) => <span className="font-mono">{row.email}</span>,
                  trailing: (row) => (
                    <span className="text-label">
                      {tenantUserStandingLabel(tenantUserStanding(row))}
                    </span>
                  ),
                }}
              />

              <ConsoleNote>
                Read-only here. Deactivating an account, clearing a lockout, revoking live sessions
                and issuing a temporary password are platform-tier actions on one person: each takes
                a stated reason, each is attributed to your verified token rather than to anything
                you could type, and each lands in the operator trail at the bottom of this page.
                Already-issued access tokens survive a deactivation until they expire — there is no
                revocation list — so &ldquo;access removed&rdquo; is never instantaneous.
              </ConsoleNote>
            </div>
          ) : null}
        </QueryBoundary>
      </div>
    </ConsoleSection>
  );
}

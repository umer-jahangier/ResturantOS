"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ShieldCheck, ShieldOff, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatTile } from "@/components/ui/stat-tile";
import { ConsoleNote } from "@/components/platform/console-section";
import { UserRowStandingBadge } from "@/components/platform/user-standing-badge";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useFleetUsers } from "@/lib/hooks/use-platform-access";
import { usePermissionMatrix } from "@/lib/hooks/use-platform-rbac";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import { roleCodeLabel } from "@/lib/models/platform-access.model";
import { tenantUserStanding, type TenantUserRow } from "@/lib/models/platform.model";

/** The page size this screen asks for. The API defaults to 50 and caps at 200. */
const PAGE_SIZE = 50;

const DATE_ONLY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/**
 * The USER states the API validates. An unrecognised value is a 400 from the producer rather than
 * an ignored filter, so the options here are the producer's vocabulary and not a superset of it.
 *
 * `ACTIVE` means usable RIGHT NOW — the flag is on and there is no live lockout — because an
 * account with a future `locked_until` cannot log in, and listing it as active tells an operator
 * the opposite of what they need.
 */
const USER_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active — can sign in now" },
  { value: "INACTIVE", label: "Deactivated" },
  { value: "LOCKED", label: "Locked out" },
] as const;

/** Tenant lifecycle states, used to narrow the fan-out rather than to filter the answer. */
const TENANT_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "PROVISIONING", label: "Provisioning" },
  { value: "PROVISIONING_FAILED", label: "Provisioning failed" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "PURGED", label: "Closed" },
] as const;

/**
 * Every user on the platform, and an honest account of how completely they were read.
 *
 * <h3>This grid is N HTTP calls, and it says so</h3>
 *
 * There is no cross-tenant user query anywhere in this product. `auth_db.users` is FORCE row-level
 * security on `app.current_tenant_id`, `platform_db` holds zero grants in `auth_db` and has
 * neither `postgres_fdw` nor `dblink`, and the only door requires an `X-Tenant-Id` and answers for
 * ONE tenant. So the endpoint behind this screen fans out one call per matching tenant, capped at
 * 100, and every answer carries a `scan` block describing what that fan-out actually managed.
 *
 * <p>Three things follow, and all three are rendered rather than smoothed:
 *
 * <ul>
 *   <li><b>An unreachable tenant is NAMED.</b> Not counted — named. "3 tenants unreachable" tells
 *       an operator their list is wrong; naming them tells them WHICH restaurant is missing from
 *       it, which is the difference between a warning they can act on and one they learn to
 *       ignore.</li>
 *   <li><b>The total is withheld, not estimated.</b> When any tenant failed or the cap bit, the
 *       API returns `totalCount: null` with a reason, and this screen renders `StatTile`'s stated
 *       absence. Filling that null with `rows.length` would print a confident number for an
 *       incomplete list — and its type would not compile anyway, which is deliberate.</li>
 *   <li><b>Narrowing removes calls.</b> The tenant and tenant-status filters are not conveniences:
 *       they shrink the fan-out, and they are the only way to get a total the API is willing to
 *       state once something is unreachable. The empty state says so.</li>
 * </ul>
 *
 * <h3>Why the search is debounced and the filters are not</h3>
 *
 * The search term is pushed to each tenant's own query rather than filtered here — a page filtered
 * after the fact carries a total describing a different set from its own rows. That means one
 * keystroke is one fan-out, so it waits. A filter change is a deliberate single act and fires
 * immediately.
 */
export function FleetUserDirectory() {
  const [tenantId, setTenantId] = React.useState("");
  const [tenantStatus, setTenantStatus] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [roleCode, setRoleCode] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);

  const debouncedSearch = useDebouncedValue(search, 350);

  /*
    Every filter restarts the paging, and it does so in the EVENT rather than in an effect that
    watches the filters. Narrowing while on page 3 otherwise asks for the fourth page of a set that
    may only have one — an empty grid reading as "nobody matches" — and the effect form of the same
    fix renders the stale page once before correcting itself, which is a request already in flight
    for a page nobody asked for.
  */
  const changeFilter = React.useCallback(
    (setter: React.Dispatch<React.SetStateAction<string>>) => (value: string) => {
      setter(value);
      setPage(0);
    },
    [],
  );

  const tenants = usePlatformTenants();
  // The role filter's vocabulary comes from the RBAC catalogue rather than from a literal list.
  // Roles are seeded by Liquibase and tenants may define their own; a hardcoded option list would
  // be right on the day it was written and would quietly stop offering a role that exists.
  const matrix = usePermissionMatrix(undefined);

  const directory = useFleetUsers({
    ...(tenantId ? { tenantId } : {}),
    ...(tenantStatus ? { tenantStatus } : {}),
    ...(status ? { status } : {}),
    ...(roleCode ? { roleCode } : {}),
    ...(debouncedSearch.trim() ? { search: debouncedSearch } : {}),
    page,
  });

  const data = directory.data;
  const rows: TenantUserRow[] = React.useMemo(() => data?.users ?? [], [data]);
  const scan = data?.scan;

  const tenantOptions = React.useMemo(
    () =>
      (tenants.data ?? []).map((tenant) => ({
        value: tenant.id,
        label: tenant.brandName,
      })),
    [tenants.data],
  );

  const roleOptions = React.useMemo(
    () =>
      (matrix.data?.rows ?? []).map((row) => ({
        value: row.roleCode,
        label: row.roleName ?? roleCodeLabel(row.roleCode),
      })),
    [matrix.data],
  );

  const filtered = Boolean(
    tenantId || tenantStatus || status || roleCode || debouncedSearch.trim(),
  );
  const clearAll = React.useCallback(() => {
    setTenantId("");
    setTenantStatus("");
    setStatus("");
    setRoleCode("");
    setSearch("");
    setPage(0);
  }, []);

  const neverSignedIn = React.useMemo(
    () => rows.filter((row) => tenantUserStanding(row) === "NEVER_SIGNED_IN").length,
    [rows],
  );

  const columns = React.useMemo<ColumnDef<TenantUserRow, unknown>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        accessorFn: (row) => row.fullName ?? row.email,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5 py-1.5">
            {/*
              `toneKey` is the user id, not the display name: two people called "Ali Raza" in two
              restaurants would otherwise wear the same colour, which on a cross-tenant grid is the
              one place that reads as "the same person twice".
            */}
            <Avatar
              name={row.original.fullName ?? row.original.email}
              toneKey={row.original.userId}
              size="sm"
            />
            <span className="block min-w-0 max-w-[18rem]">
              {/*
                The anchor wraps the NAME only. An anchor containing both lines has an accessible
                name of "Ali Raza ali@example.com", which is what a screen reader announces and
                what a by-name locator has to match.
              */}
              <Link
                href={`/platform/users/${row.original.tenantId}/${row.original.userId}`}
                data-testid={`fleet-user-row-${row.original.userId}`}
                className="block truncate font-medium text-foreground hover:text-primary"
              >
                {row.original.fullName ?? row.original.email}
              </Link>
              <span className="block truncate font-mono text-label text-foreground-tertiary">
                {row.original.email}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "tenant",
        header: "Tenant",
        accessorFn: (row) => row.tenantBrandName ?? row.tenantSlug ?? "",
        cell: ({ row }) => (
          <span className="block max-w-[14rem] py-1.5">
            <Link
              href={`/platform/tenants/${row.original.tenantId}`}
              className="block truncate text-foreground hover:text-primary"
            >
              {row.original.tenantBrandName ?? (
                <span className="text-foreground-tertiary">Unnamed tenant</span>
              )}
            </Link>
            {/* The slug is what login resolves a tenant by and what an operator recognises in a
                log line, so it stays in the mono face rather than being dropped for space. */}
            <span className="block truncate font-mono text-label text-foreground-tertiary">
              {row.original.tenantSlug ?? "no slug"}
            </span>
          </span>
        ),
      },
      {
        id: "standing",
        header: "Standing",
        accessorFn: (row) => tenantUserStanding(row),
        cell: ({ row }) => <UserRowStandingBadge user={row.original} />,
      },
      {
        id: "totp",
        header: "Two-factor",
        accessorFn: (row) => (row.totpEnabled ? 1 : 0),
        meta: { hideBelow: "lg" },
        cell: ({ row }) =>
          row.original.totpEnabled ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-success">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              On
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-foreground-tertiary">
              <ShieldOff className="size-3.5 shrink-0" aria-hidden="true" />
              Off
            </span>
          ),
      },
      {
        id: "last-login",
        header: "Last sign-in",
        // Never-signed-in sorts to the top: it is the row an operator came here to find.
        accessorFn: (row) => row.lastLoginAt?.getTime() ?? 0,
        meta: { hideBelow: "md" },
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
    <div className="flex flex-col gap-(--space-lg)">
      <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        {/*
          The tile that refuses to make a number up. `unavailableReason` and `value` are a
          discriminated union on `StatTile`, so the branch below is not a convention a future
          author can forget — passing both does not compile.
        */}
        {scan && scan.totalCount !== null ? (
          <StatTile
            label="People across the fleet"
            value={formatNumber(scan.totalCount)}
            icon={Users}
            accent="primary"
          />
        ) : (
          <StatTile
            label="People across the fleet"
            icon={Users}
            accent="primary"
            unavailableReason={
              scan?.totalCountNote ??
              "The fleet total is only knowable when every tenant answers. Narrow by tenant or tenant status for a countable answer."
            }
          />
        )}

        <StatTile
          label="Listed on this page"
          value={formatNumber(rows.length)}
          icon={Users}
          accent="secondary"
        />

        {scan ? (
          <StatTile
            label="Tenants read"
            value={`${formatNumber(scan.tenantsScanned)} of ${formatNumber(scan.tenantsMatched)}`}
          />
        ) : (
          <StatTile label="Tenants read" unavailableReason="The scan has not reported yet." />
        )}

        {/*
          Counted from the rows on screen and LABELLED as such. The honest alternative — a fleet
          figure — would need a second fan-out with `status` set, and would still be withheld the
          moment one tenant failed.
        */}
        <StatTile
          label="Never signed in, on this page"
          value={formatNumber(neverSignedIn)}
          accent={neverSignedIn > 0 ? "secondary" : "none"}
        />
      </div>

      <FilterBar
        title="Find a person"
        search={{
          value: search,
          onChange: changeFilter(setSearch),
          label: "Search every tenant by name or email",
          placeholder: "Name or email…",
        }}
        filters={[
          {
            id: "tenant",
            label: "Tenant",
            value: tenantId,
            onChange: changeFilter(setTenantId),
            options: tenantOptions,
            allLabel: "Every tenant",
            isLoading: tenants.isLoading,
            error: tenants.isError,
            onRetry: () => void tenants.refetch(),
            testId: "fleet-filter-tenant",
          },
          {
            id: "tenant-status",
            label: "Tenant state",
            value: tenantStatus,
            onChange: changeFilter(setTenantStatus),
            options: TENANT_STATUS_OPTIONS,
            allLabel: "Any tenant state",
            testId: "fleet-filter-tenant-status",
          },
          {
            id: "status",
            label: "Account",
            value: status,
            onChange: changeFilter(setStatus),
            options: USER_STATUS_OPTIONS,
            allLabel: "Any account state",
            testId: "fleet-filter-status",
          },
          {
            id: "role",
            label: "Role",
            value: roleCode,
            onChange: changeFilter(setRoleCode),
            options: roleOptions,
            allLabel: "Any role",
            isLoading: matrix.isLoading,
            error: matrix.isError,
            onRetry: () => void matrix.refetch(),
            testId: "fleet-filter-role",
          },
        ]}
        onClearAll={clearAll}
      />

      <ConsoleNote data-testid="fleet-scan-explainer">
        This list is assembled one call per tenant — there is no cross-tenant user query in this
        product, because each restaurant&apos;s user records are isolated from every other
        restaurant&apos;s at the database. Choosing a tenant or a tenant state removes calls, and it
        is the only way to get a total once something is unreachable.
      </ConsoleNote>

      <QueryBoundary
        query={directory}
        what="the fleet user directory"
        loading={<DataTableSkeleton columns={6} />}
        isEmpty={Boolean(data) && rows.length === 0 && !filtered}
        empty={
          <ConsoleNote tone="warning" data-testid="fleet-users-empty">
            No user accounts were found in any tenant that answered. That is not a normal state —
            provisioning creates a first administrator for every restaurant — so it usually means
            either the fleet is empty or the scan below could not read anybody.
          </ConsoleNote>
        }
      >
        {data && scan ? (
          <div className="flex flex-col gap-(--space-md)">
            {/*
              The provenance block, and the reason this screen exists in the shape it does. The
              tenants are NAMED. A count alone tells an operator their list is wrong; the names tell
              them which restaurant is missing from it.
            */}
            {scan.unreachable.length > 0 && (
              <ConsoleNote tone="warning" role="alert" data-testid="fleet-scan-unreachable">
                <span className="font-semibold">
                  {formatNumber(scan.unreachable.length)}{" "}
                  {scan.unreachable.length === 1 ? "tenant" : "tenants"} could not be reached —{" "}
                  {scan.unreachable
                    .map((tenant) => tenant.tenantSlug ?? tenant.tenantId)
                    .join(", ")}
                  .
                </span>{" "}
                Their users are absent from the rows below and are counted in no figure on this
                screen. This is a read failure, not a restaurant without staff.
                {scan.unreachable.some((tenant) => tenant.detail) && (
                  <span className="mt-2 block font-mono text-label text-foreground-secondary">
                    {scan.unreachable
                      .filter((tenant) => tenant.detail)
                      .map((tenant) => `${tenant.tenantSlug ?? tenant.tenantId}: ${tenant.detail}`)
                      .join(" · ")}
                  </span>
                )}
              </ConsoleNote>
            )}

            {scan.truncated && (
              <ConsoleNote tone="warning" role="alert" data-testid="fleet-scan-truncated">
                <span className="font-semibold">The scan stopped short.</span> It read{" "}
                {formatNumber(scan.tenantsScanned)} of {formatNumber(scan.tenantsMatched)} matching
                tenants, in slug order, so what follows is the beginning of the answer rather than
                the answer. Narrow by tenant or tenant state to see the rest.
              </ConsoleNote>
            )}

            <p className="text-small text-foreground-secondary" data-testid="fleet-scan-summary">
              <span className="font-medium text-foreground">
                {scan.totalCount === null
                  ? "Total withheld"
                  : `${formatNumber(scan.totalCount)} ${scan.totalCount === 1 ? "person" : "people"}`}
              </span>
              {scan.totalCount === null ? (
                <span>
                  {" — "}
                  {scan.totalCountNote ??
                    "the scan could not read every tenant it matched, so no total is knowable from it."}
                </span>
              ) : (
                <span>
                  {" across "}
                  {formatNumber(scan.tenantsScanned)}{" "}
                  {scan.tenantsScanned === 1 ? "tenant" : "tenants"}
                  {rows.length === scan.totalCount
                    ? ", all listed below."
                    : `, of which ${formatNumber(rows.length)} are on this page.`}
                </span>
              )}
            </p>

            <DataGrid
              columns={columns}
              data={rows}
              label="Every user across every tenant"
              getRowId={(row) => row.userId}
              // Server-side paging already applies the filters, so a page that comes back empty is
              // a filtered-empty state and not an empty product. Saying "no users yet" to somebody
              // who just typed a search would be the product telling them the fleet is deserted.
              isFiltered={filtered}
              onClearFilters={clearAll}
              pageSize={PAGE_SIZE}
              emptyTitle="No user accounts"
              emptyDescription="Provisioning creates a first administrator for every restaurant, so an empty fleet usually means provisioning has not finished anywhere."
              card={{
                primary: (row) => (
                  <Link
                    href={`/platform/users/${row.tenantId}/${row.userId}`}
                    data-testid={`fleet-user-card-${row.userId}`}
                    className="font-medium"
                  >
                    {row.fullName ?? row.email}
                  </Link>
                ),
                secondary: (row) => (
                  <span className="font-mono">
                    {row.email} · {row.tenantSlug ?? "no slug"}
                  </span>
                ),
                trailing: (row) => <UserRowStandingBadge user={row} />,
              }}
            />

            <FleetPager
              page={page}
              rowsOnPage={rows.length}
              totalCount={scan.totalCount}
              isFetching={directory.isFetching}
              onPage={setPage}
            />
          </div>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

/**
 * Server-side paging over an answer whose size may be unknown.
 *
 * <h3>Why "next" is offered rather than counted</h3>
 *
 * When the total is withheld — any unreachable tenant, or a truncated scan — there is no last-page
 * marker to compute, and inventing one from `rows.length` would either hide a page that exists or
 * offer one that does not. So the control says which of the two situations it is in: with a total
 * it reads as a range out of that total, and without one it says plainly that the end can only be
 * found by asking. A pager that looked identical in both cases would be the same fabrication as a
 * fabricated total, one interaction later.
 */
function FleetPager({
  page,
  rowsOnPage,
  totalCount,
  isFetching,
  onPage,
}: {
  page: number;
  rowsOnPage: number;
  totalCount: number | null;
  isFetching: boolean;
  onPage: (page: number) => void;
}) {
  const first = page * PAGE_SIZE + 1;
  const last = page * PAGE_SIZE + rowsOnPage;
  const hasNext = totalCount === null ? rowsOnPage === PAGE_SIZE : last < totalCount;
  const hasPrev = page > 0;

  if (!hasPrev && !hasNext) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-(--space-sm)"
      data-testid="fleet-pager"
    >
      <p
        className={cn(
          "text-small",
          totalCount === null ? "text-warning" : "text-foreground-secondary",
        )}
      >
        {rowsOnPage === 0
          ? "This page is empty."
          : totalCount === null
            ? `Showing ${formatNumber(first)}–${formatNumber(last)}. The total is unknown, so there is no last page to count towards — “next” is offered while a page comes back full.`
            : `Showing ${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(totalCount)}.`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev || isFetching}
          onClick={() => onPage(page - 1)}
          data-testid="fleet-pager-prev"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext || isFetching}
          onClick={() => onPage(page + 1)}
          data-testid="fleet-pager-next"
        >
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatTile } from "@/components/ui/stat-tile";
import { TenantStatusBadge, TierBadge } from "@/components/platform/tenant-badges";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant, TenantStatus, TenantTier } from "@/lib/models/platform.model";

/**
 * The tenant register: every restaurant group on the platform, and what state each is in.
 *
 * <h3>The counts above the grid describe the grid</h3>
 *
 * A stat strip that disagrees with the table under it is worse than no stat strip, because the
 * operator has no way to tell which half is wrong. So every figure here is derived from the SAME
 * array the grid renders — there is no second endpoint, no cached aggregate and no server-side
 * count — and the reconciliation line spells the arithmetic out: the six status counts sum to the
 * fleet total, and the grid's own footer states how many rows the current filters left.
 *
 * <h3>What is deliberately not here</h3>
 *
 * No revenue, no MRR, no ARR, no invoice state, no payment status and no churn value. Not as a
 * number, not as a zero, not as an empty chart. **This product has no billing.** Sixteen services
 * were enumerated for it: `billing_ref` is a free-text VARCHAR on the tenant row with no foreign
 * key and no writer beyond an operator typing into it, and there is no invoice table, no payment
 * table and no processor integration anywhere. A tile reading "PKR 0 MRR" would be a fabrication
 * rendered in the product's own confident voice, on the screen where commercial decisions are made.
 *
 * <p>The fleet USER count is a subtler version of the same problem, and it is the fourth tile —
 * stated as an absence rather than omitted, because an operator who cannot see it deserves to know
 * why. `auth_db.users` is FORCE row-level security per tenant, platform_db holds no grant in it and
 * there is no FDW, so a fleet total is one HTTP call per restaurant. `StatTile`'s
 * `unavailableReason` is a discriminated union — a value cannot be passed beside it and the
 * compiler enforces that, which is the point.
 */

type ProvisioningFilter = "" | "settled" | "in-progress" | "failed";

const STATUS_OPTIONS: ReadonlyArray<{ value: TenantStatus; label: string }> = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "PURGED", label: "Closed" },
  { value: "PROVISIONING", label: "Provisioning" },
  { value: "PROVISIONING_FAILED", label: "Provisioning failed" },
];

const TIER_OPTIONS: ReadonlyArray<{ value: TenantTier; label: string }> = [
  { value: "STARTER", label: "Starter" },
  { value: "GROWTH", label: "Growth" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "CUSTOM", label: "Custom" },
];

/**
 * Provisioning is a VIEW of the status column, not a second source of truth.
 *
 * The filter exists because "show me what never came up" is a question an operator asks in those
 * words, and answering it by picking two entries out of a six-item status list is a step they will
 * get wrong. It is labelled as a lens on the same column so nobody reads the two filters as
 * independent facts that could disagree.
 */
const PROVISIONING_OPTIONS: ReadonlyArray<{
  value: Exclude<ProvisioningFilter, "">;
  label: string;
}> = [
  { value: "settled", label: "Completed" },
  { value: "in-progress", label: "Still running" },
  { value: "failed", label: "Failed" },
];

function provisioningStateOf(status: TenantStatus): Exclude<ProvisioningFilter, ""> {
  if (status === "PROVISIONING") return "in-progress";
  if (status === "PROVISIONING_FAILED") return "failed";
  return "settled";
}

/** A ceiling, or the honest absence of one. Never `0`, which would read as "none allowed". */
function ceiling(value: number | null, unit?: string): React.ReactNode {
  if (value === null) return <span className="text-foreground-tertiary">Not set</span>;
  if (value < 0) return <span className="text-foreground-secondary">Uncapped</span>;
  return (
    <>
      {formatNumber(value)}
      {unit ? <span className="text-foreground-tertiary"> {unit}</span> : null}
    </>
  );
}

export function TenantDirectory({ onCreate }: { onCreate: () => void }) {
  const tenants = usePlatformTenants();

  const [status, setStatus] = React.useState<string>("");
  const [tier, setTier] = React.useState<string>("");
  const [provisioning, setProvisioning] = React.useState<string>("");
  const [search, setSearch] = React.useState("");

  const all: PlatformTenant[] = React.useMemo(() => tenants.data ?? [], [tenants.data]);

  const counts = React.useMemo(() => {
    const byStatus = {
      ACTIVE: 0,
      SUSPENDED: 0,
      CANCELLED: 0,
      PURGED: 0,
      PROVISIONING: 0,
      PROVISIONING_FAILED: 0,
    } satisfies Record<TenantStatus, number>;
    for (const tenant of all) byStatus[tenant.status] += 1;
    return byStatus;
  }, [all]);

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((tenant) => {
      if (status && tenant.status !== status) return false;
      if (tier && tenant.tier !== tier) return false;
      if (provisioning && provisioningStateOf(tenant.status) !== provisioning) return false;
      if (
        needle &&
        !tenant.brandName.toLowerCase().includes(needle) &&
        !tenant.slug.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [all, status, tier, provisioning, search]);

  const filtered = Boolean(status || tier || provisioning || search.trim());
  const clearAll = React.useCallback(() => {
    setStatus("");
    setTier("");
    setProvisioning("");
    setSearch("");
  }, []);

  const columns = React.useMemo<ColumnDef<PlatformTenant, unknown>[]>(
    () => [
      {
        id: "tenant",
        header: "Tenant",
        accessorFn: (row) => row.brandName,
        cell: ({ row }) => (
          <span className="block max-w-[22rem] py-1.5">
            {/*
              The link wraps the BRAND NAME only, not the slug beneath it. An anchor containing
              both lines has an accessible name of "Floating Terrace floating-terrace", which is
              what a screen reader reads out and what a by-name locator has to match — and the slug
              is not a second destination anyway. Keeping it outside the anchor makes the link's
              name the tenant's name.
            */}
            <Link
              href={`/platform/tenants/${row.original.id}`}
              data-testid={`tenant-row-${row.original.slug}`}
              className="block truncate font-medium text-foreground hover:text-primary"
            >
              {row.original.brandName}
            </Link>
            {/* The slug is what login resolves a tenant by and what an operator recognises in a
                log line, so it is set in the mono face beside the display name rather than being
                dropped for space. */}
            <span className="block truncate font-mono text-label text-foreground-tertiary">
              {row.original.slug}
            </span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => row.status,
        cell: ({ row }) => <TenantStatusBadge status={row.original.status} />,
      },
      {
        id: "tier",
        header: "Tier",
        accessorFn: (row) => row.tier,
        cell: ({ row }) => <TierBadge tier={row.original.tier} />,
      },
      {
        id: "branches",
        // "Ceiling", not "Branches": the number is an entitlement, and a column headed with the
        // noun alone is read as a count of live branches by everyone who has ever seen a table.
        header: "Branch ceiling",
        accessorFn: (row) => row.maxBranches ?? -1,
        meta: { mono: true, align: "end" },
        cell: ({ row }) => ceiling(row.original.maxBranches),
      },
      {
        id: "users",
        header: "User ceiling",
        accessorFn: (row) => row.maxUsers ?? -1,
        meta: { mono: true, align: "end", hideBelow: "lg" },
        cell: ({ row }) => ceiling(row.original.maxUsers),
      },
      {
        id: "storage",
        header: "Storage",
        accessorFn: (row) => row.storageGb ?? -1,
        meta: { mono: true, align: "end", hideBelow: "xl" },
        cell: ({ row }) => ceiling(row.original.storageGb, "GB"),
      },
      {
        id: "created",
        header: "Created",
        accessorFn: (row) => row.createdAt.getTime(),
        meta: { hideBelow: "lg" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDateTime(row.original.createdAt, {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "id",
        header: "Tenant id",
        accessorFn: (row) => row.id,
        meta: { mono: true, hideBelow: "xl" },
        cell: ({ row }) => (
          <span className="text-foreground-tertiary">{row.original.id.slice(0, 8)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Tenants on the platform"
          value={formatNumber(all.length)}
          icon={Building2}
          accent="primary"
        />
        <StatTile
          label="Serving now"
          value={formatNumber(counts.ACTIVE)}
          icon={CheckCircle2}
          accent="secondary"
        />
        <StatTile
          label="Needs an operator"
          value={formatNumber(counts.SUSPENDED + counts.PROVISIONING_FAILED)}
          icon={AlertTriangle}
        />
        {/*
          The tile that refuses to make a number up. There is no cross-tenant user query in this
          product — `auth_db.users` is FORCE row-level security on `app.current_tenant_id`,
          platform_db holds zero grants in auth_db, and the only door takes one `X-Tenant-Id` — so a
          fleet total is one HTTP call per restaurant, with one chance per restaurant to be wrong.
          The per-tenant count IS available and is on each tenant's own screen.
        */}
        <StatTile
          label="People across the fleet"
          icon={Users}
          unavailableReason="No cross-tenant user count exists. Tenant user records are isolated per restaurant, so a fleet total would be one call per tenant — open a tenant to see its own."
        />
      </div>

      <QueryBoundary
        query={tenants}
        what="the tenant list"
        loading={<DataTableSkeleton columns={6} />}
        isEmpty={all.length === 0}
        empty={
          <EmptyState
            icon={Building2}
            title="No tenants yet"
            description="Provision the first restaurant group to get started."
            action={{ label: "Create tenant", onClick: onCreate }}
          />
        }
      >
        <div className="flex flex-col gap-(--space-md)">
          <FilterBar
            title="Filters"
            search={{
              value: search,
              onChange: setSearch,
              label: "Search tenants by name or slug",
              placeholder: "Name or slug…",
            }}
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                onChange: setStatus,
                options: STATUS_OPTIONS,
                allLabel: "Any status",
                testId: "tenant-filter-status",
              },
              {
                id: "tier",
                label: "Tier",
                value: tier,
                onChange: setTier,
                options: TIER_OPTIONS,
                allLabel: "Any tier",
                testId: "tenant-filter-tier",
              },
              {
                id: "provisioning",
                label: "Provisioning",
                value: provisioning,
                onChange: setProvisioning,
                options: PROVISIONING_OPTIONS,
                allLabel: "Any provisioning state",
                testId: "tenant-filter-provisioning",
              },
            ]}
            onClearAll={clearAll}
          />

          {/*
            The reconciliation line. Every number in it is counted from `all`, the same array the
            grid renders, and the six statuses sum to the total — so an operator can check the strip
            against the table without leaving the screen. `DataGrid` prints the filtered row count in
            its own footer, and the sentence below says which number that one should equal.
          */}
          <p
            className="text-small text-foreground-secondary"
            data-testid="tenant-directory-reconciliation"
          >
            <span className="font-medium text-foreground">
              {formatNumber(all.length)} tenant{all.length === 1 ? "" : "s"}
            </span>
            {": "}
            {formatNumber(counts.ACTIVE)} active · {formatNumber(counts.SUSPENDED)} suspended ·{" "}
            {formatNumber(counts.CANCELLED)} cancelled · {formatNumber(counts.PURGED)} closed ·{" "}
            {formatNumber(counts.PROVISIONING)} provisioning ·{" "}
            {formatNumber(counts.PROVISIONING_FAILED)} failed.{" "}
            {filtered ? (
              <span className={cn("font-medium", rows.length === 0 && "text-warning")}>
                Filters show {formatNumber(rows.length)} of them.
              </span>
            ) : (
              <span>All of them are listed below.</span>
            )}
          </p>

          <div data-testid="tenant-table">
            <DataGrid
              columns={columns}
              data={rows}
              label="Platform tenants"
              getRowId={(row) => row.id}
              isFiltered={filtered}
              onClearFilters={clearAll}
              emptyTitle="No tenants yet"
              emptyDescription="Provision the first restaurant group to get started."
              emptyAction={{ label: "Create tenant", onClick: onCreate }}
              card={{
                primary: (row) => (
                  <Link
                    href={`/platform/tenants/${row.id}`}
                    data-testid={`tenant-card-${row.slug}`}
                    className="font-medium"
                  >
                    {row.brandName}
                  </Link>
                ),
                secondary: (row) => <span className="font-mono">{row.slug}</span>,
                trailing: (row) => (
                  <span className="flex flex-col items-end gap-1">
                    <TenantStatusBadge status={row.status} />
                    <TierBadge tier={row.tier} />
                  </span>
                ),
              }}
            />
          </div>
        </div>
      </QueryBoundary>
    </div>
  );
}

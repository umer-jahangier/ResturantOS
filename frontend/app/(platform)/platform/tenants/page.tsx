"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { CreateTenantDialog } from "@/components/platform/create-tenant-dialog";
import { TenantStatusBadge, TierBadge } from "@/components/platform/tenant-badges";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant } from "@/lib/models/platform.model";

/**
 * URL: /platform/tenants — the tenant list (GA-050, GA-053).
 *
 * This route was declared in `platformNavItems` and had no page: the product's only unguarded dead
 * link, rendering "404: This page could not be found." Five of the nine audits reported it
 * independently.
 *
 * <h3>Entitlement ceilings are shown here</h3>
 *
 * `maxBranches`, `maxUsers`, `storageGb` and `nlqQuota` come back on every row of
 * `GET /api/v1/platform/tenants` and, before this phase, grepping the entire frontend for those
 * four names returned zero matches (GA-083). Limits are surfaced in the list because tier alone
 * does not tell an operator what a tenant is entitled to — `CUSTOM` in particular means nothing
 * without its numbers.
 *
 * <h3>What is deliberately absent</h3>
 *
 * UI-SPEC §7.5 sketches columns for MRR and last-active. Neither exists in any API this console
 * can call — there is no billing amount on the tenant row and no activity timestamp. They are
 * omitted rather than filled with a plausible-looking placeholder, for the same reason the usage
 * panel refuses to render a zero.
 */
export default function PlatformTenantsPage() {
  const tenants = usePlatformTenants();
  const [createOpen, setCreateOpen] = React.useState(false);

  // PURGED tenants are hidden by default: the row is retained for referential integrity, the
  // tenant no longer exists operationally, and a list dominated by tombstones buries the live ones.
  const [showPurged, setShowPurged] = React.useState(false);
  const rows: PlatformTenant[] = React.useMemo(() => {
    const all = tenants.data ?? [];
    return showPurged ? all : all.filter((t) => t.status !== "PURGED");
  }, [tenants.data, showPurged]);

  const purgedCount = (tenants.data ?? []).filter((t) => t.status === "PURGED").length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Every restaurant group on the platform, with the entitlements their tier grants.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="create-tenant-open">
          <Plus className="size-4" aria-hidden="true" />
          Create tenant
        </Button>
      </header>

      <QueryBoundary
        query={tenants}
        what="the tenant list"
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={Building2}
            title="No tenants yet"
            description="Provision the first one to get started."
            action={{ label: "Create tenant", onClick: () => setCreateOpen(true) }}
          />
        }
      >
        <div className="relative overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="tenant-table">
            <caption className="sr-only">Platform tenants</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Tenant
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Tier
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Branches
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Users
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Storage
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="border-t hover:bg-muted/40"
                  data-testid={`tenant-row-${tenant.slug}`}
                >
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <Link
                      href={`/platform/tenants/${tenant.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {tenant.brandName}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {tenant.slug}
                    </span>
                  </th>
                  <td className="px-4 py-2.5">
                    <TenantStatusBadge status={tenant.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <TierBadge tier={tenant.tier} />
                  </td>
                  {/*
                    These are CEILINGS, never current counts — the header says "Branches" and the
                    cell says "max 50", so the column cannot be misread as usage. The one real
                    usage number the platform has lives on the tenant detail screen, where it can
                    be shown beside its limit without ambiguity.
                  */}
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    max {tenant.maxBranches ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    max {tenant.maxUsers ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {tenant.storageGb ?? "—"} GB
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {tenant.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryBoundary>

      {purgedCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowPurged((v) => !v)}>
          {showPurged ? "Hide" : "Show"} {purgedCount} purged tenant
          {purgedCount === 1 ? "" : "s"}
        </Button>
      )}

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

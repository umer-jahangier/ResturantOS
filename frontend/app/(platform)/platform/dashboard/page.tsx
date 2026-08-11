"use client";

import Link from "next/link";
import { AlertTriangle, Building2, PauseCircle, ShieldCheck } from "lucide-react";

import { QueryBoundary } from "@/components/ui/query-boundary";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant } from "@/lib/models/platform.model";

/**
 * URL: /platform/dashboard — the platform overview.
 *
 * <h3>Every number here is counted from data on screen</h3>
 *
 * The counts are derived from the tenant list this page has already fetched, so each one can be
 * verified by clicking through to the list and counting rows. Nothing is aggregated by an endpoint
 * that does not exist, and there is no "revenue" or "growth" tile — there is no billing amount
 * anywhere in the platform API, and a dashboard whose headline figure is invented is worse than a
 * dashboard with fewer tiles.
 *
 * Tenants needing attention are listed explicitly rather than reduced to a count, because
 * `PROVISIONING_FAILED` is a state a human has to act on: 13-14 added a retry endpoint precisely
 * because such a tenant was previously unrecoverable through the API.
 */
export default function PlatformDashboardPage() {
  const tenants = usePlatformTenants();
  const all = tenants.data ?? [];

  const live = all.filter((t) => t.status !== "PURGED");
  const active = live.filter((t) => t.status === "ACTIVE");
  const suspended = live.filter((t) => t.status === "SUSPENDED");
  const failed = live.filter((t) => t.status === "PROVISIONING_FAILED");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Platform overview</h1>
        <p className="text-sm text-muted-foreground">
          Every action taken here affects a whole restaurant group, not one branch.
        </p>
      </header>

      <QueryBoundary query={tenants} what="the platform overview">
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={Building2}
              label="Tenants"
              value={live.length}
              hint="Excluding purged"
            />
            <StatTile icon={ShieldCheck} label="Active" value={active.length} />
            <StatTile
              icon={PauseCircle}
              label="Suspended"
              value={suspended.length}
              tone={suspended.length > 0 ? "warning" : undefined}
            />
            <StatTile
              icon={AlertTriangle}
              label="Provisioning failed"
              value={failed.length}
              tone={failed.length > 0 ? "danger" : undefined}
            />
          </div>

          {failed.length > 0 && (
            <section className="space-y-2" aria-labelledby="attention-heading">
              <h2 id="attention-heading" className="text-lg font-semibold">
                Needs attention
              </h2>
              <ul className="divide-y rounded-lg border">
                {failed.map((tenant) => (
                  <li key={tenant.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <Link
                        href={`/platform/tenants/${tenant.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {tenant.brandName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Provisioning did not complete. This tenant has no working administrator
                        account until it is re-driven.
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2" aria-labelledby="by-tier-heading">
            <h2 id="by-tier-heading" className="text-lg font-semibold">
              By tier
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(["STARTER", "GROWTH", "ENTERPRISE", "CUSTOM"] as const).map((tier) => (
                <li key={tier} className="rounded-lg border px-4 py-3">
                  <span className="text-sm text-muted-foreground">{tier}</span>
                  <span className="block text-xl font-semibold tabular-nums">
                    {countTier(live, tier)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <Link
            href="/platform/tenants"
            className="inline-block text-sm text-primary hover:underline"
          >
            Manage tenants →
          </Link>
        </>
      </QueryBoundary>
    </div>
  );
}

function countTier(tenants: PlatformTenant[], tier: PlatformTenant["tier"]): number {
  return tenants.filter((t) => t.tier === tier).length;
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: number;
  hint?: string;
  tone?: "warning" | "danger";
}) {
  return (
    <div
      className="rounded-lg border p-4"
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden={true} />
        {label}
      </div>
      <p
        className={
          tone === "danger"
            ? "mt-1 text-2xl font-semibold tabular-nums text-destructive"
            : tone === "warning"
              ? "mt-1 text-2xl font-semibold tabular-nums text-warning"
              : "mt-1 text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

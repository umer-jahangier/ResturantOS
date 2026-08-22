"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { FeatureMatrix } from "@/components/platform/feature-matrix";
import { TenantActivityPanel } from "@/components/platform/tenant-activity-panel";
import { TenantConfigurationPanel } from "@/components/platform/tenant-configuration-panel";
import { TenantImpersonationPanel } from "@/components/platform/tenant-impersonation-panel";
import { TenantLifecycleActions } from "@/components/platform/tenant-lifecycle-actions";
import { TenantOverviewPanel } from "@/components/platform/tenant-overview-panel";
import { TenantStatusBadge, TierBadge } from "@/components/platform/tenant-badges";
import { TenantSubscriptionPanel } from "@/components/platform/tenant-subscription-panel";
import { TenantUsersPanel } from "@/components/platform/tenant-users-panel";
import { UsagePanel } from "@/components/platform/usage-panel";
import { usePlatformTenant } from "@/lib/hooks/use-platform-tenants";

/**
 * URL: `/platform/tenants/{id}` — one tenant, and everything an operator can do to it.
 *
 * <h3>Sections, not tabs</h3>
 *
 * Nine panels, all mounted, in the order an operator reads them: who this is · how to change its
 * state · what it is configured as · what it is sold · what it consumes · what it can reach · who
 * works there · who from the platform has been inside it · what platform staff have done to it.
 *
 * <p>They are stacked rather than tabbed for one reason that outweighs the scrolling: a tab hides
 * the panel you did not think to open. On a control plane the thing an operator most needs to see
 * before suspending a restaurant — that four people have never signed in, that a module was
 * revoked by hand, that somebody impersonated into it last week — is precisely the thing they were
 * not looking for. The section rail at the top jumps to any of them, and every heading is a real
 * `<h2>` so the same jumps exist for a screen-reader user.
 *
 * <h3>Every panel owns its own query, its own failure and its own absence</h3>
 *
 * There is no single "tenant page" fetch. Subscription, limits, usage, modules, users,
 * impersonations and the operator trail are seven independent reads across four services, and one
 * of them being down must not blank the other six — a control plane that goes dark because the
 * subscription registry is unreachable is a control plane you cannot use during an incident. Each
 * panel therefore renders its own `QueryBoundary`, and each states what it could not read.
 */
export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const tenant = usePlatformTenant(tenantId);
  const data = tenant.data;

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <Link
        href="/platform/tenants"
        className="inline-flex w-fit items-center gap-1.5 text-small text-foreground-secondary hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All tenants
      </Link>

      <QueryBoundary query={tenant} what="this tenant" loading={<Skeleton className="h-40" />}>
        {data && (
          <div className="flex flex-col gap-(--space-lg)">
            <PageHeader
              title={data.brandName}
              meta={
                <span className="flex flex-wrap items-center gap-(--space-sm)">
                  {/*
                    A hidden anchor for the shipped end-to-end contract, which pins the heading text
                    by test id. `PageHeader` owns the visible <h1> — this product has sixty
                    hand-written ones and the primitive exists to stop the sixty-first — and it takes
                    no test id, so the contract is preserved here instead. `aria-hidden` because the
                    heading beside it already announces the name and a second copy would say it
                    twice.
                  */}
                  <span className="sr-only" aria-hidden="true" data-testid="tenant-detail-name">
                    {data.brandName}
                  </span>
                  <span className="font-mono text-small text-foreground-tertiary">{data.slug}</span>
                  <TenantStatusBadge status={data.status} />
                  <TierBadge tier={data.tier} />
                </span>
              }
            />

            <SectionRail />

            <TenantOverviewPanel tenant={data} />
            <TenantLifecycleActions tenant={data} />
            <TenantConfigurationPanel tenant={data} />
            <TenantSubscriptionPanel tenant={data} />
            <UsagePanel tenantId={tenantId} />
            <FeatureMatrix tenantId={tenantId} tenantName={data.brandName} />
            <TenantUsersPanel tenantId={tenantId} tenantName={data.brandName} />
            <TenantImpersonationPanel tenantId={tenantId} tenantName={data.brandName} />
            <TenantActivityPanel tenantId={tenantId} tenantName={data.brandName} />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

const SECTIONS = [
  { href: "#overview", label: "Overview" },
  { href: "#lifecycle", label: "Lifecycle" },
  { href: "#configuration", label: "Configuration" },
  { href: "#subscription", label: "Subscription" },
  { href: "#usage", label: "Usage" },
  { href: "#modules", label: "Modules" },
  { href: "#users", label: "People" },
  { href: "#access", label: "Platform access" },
  { href: "#activity", label: "Activity" },
] as const;

/**
 * Jump links for the nine panels.
 *
 * <p>Deliberately not `SectionTabs`, which is a ROUTE strip: it reads `usePathname` and marks a tab
 * current by prefix, so on a single route every one of these would render as the active tab. These
 * are fragment links into one document — the eyebrow voice the console uses everywhere, wrapping
 * rather than scrolling, and each target carries `scroll-mt` so a jumped-to heading does not land
 * under the platform header.
 */
function SectionRail() {
  return (
    <nav
      aria-label="Tenant sections"
      data-testid="tenant-section-rail"
      className="flex flex-wrap gap-x-(--space-md) gap-y-1 border-y border-border py-2"
    >
      {SECTIONS.map((section) => (
        <a
          key={section.href}
          href={section.href}
          className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase transition-colors hover:text-primary"
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

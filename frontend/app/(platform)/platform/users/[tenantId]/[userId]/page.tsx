"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAccessPanel } from "@/components/platform/user-access-panel";
import { UserAuditPanel } from "@/components/platform/user-audit-panel";
import { UserIdentityPanel } from "@/components/platform/user-identity-panel";
import { UserLifecycleActions } from "@/components/platform/user-lifecycle-actions";
import { usePlatformUser } from "@/lib/hooks/use-platform-access";

/**
 * URL: `/platform/users/{tenantId}/{userId}` — one person, and everything the platform may do
 * about them.
 *
 * <h3>Why the tenant is in the path</h3>
 *
 * Because the API needs it and there is no way around it. Every read and every write about a user
 * goes through `/api/v1/platform/tenants/{tenantId}/users/{userId}`: `auth_db.users` is FORCE
 * row-level security on `app.current_tenant_id`, so the tenant is not a convenience in the URL, it
 * is the value that makes the row visible at all. A route keyed on the user id alone would have to
 * find the tenant first — by fanning out across every restaurant on the platform, which is exactly
 * the cost the directory screen exists to avoid repeating.
 *
 * <h3>Four panels, all mounted, in the order an operator reads them</h3>
 *
 * Who this is · what can be done to the account · what it is entitled to · what has already been
 * done to it. Stacked rather than tabbed for the reason the tenant screen gives: a tab hides the
 * panel you did not think to open, and on a control plane the thing most worth seeing before
 * deactivating somebody — that they hold no roles at all, that a colleague reset their password an
 * hour ago — is precisely the thing nobody goes looking for.
 *
 * <h3>The trail owns its own query, and its own failure</h3>
 *
 * The operator trail is a separate read against a separate table, and it is allowed to fail on its
 * own. An unreachable audit reader must not blank the account it describes, and it must not render
 * as "nothing has been done to this person" — those are opposite answers, and only one of them is
 * a reason to stop worrying.
 */
export default function PlatformUserDetailPage() {
  const params = useParams<{ tenantId: string; userId: string }>();
  const tenantId = params.tenantId;
  const userId = params.userId;

  const user = usePlatformUser(tenantId, userId);
  const data = user.data;

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <Link
        href="/platform/users"
        className="inline-flex w-fit items-center gap-1.5 text-small text-foreground-secondary hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All people
      </Link>

      <QueryBoundary query={user} what="this user" loading={<Skeleton className="h-40" />}>
        {data && (
          <div className="flex flex-col gap-(--space-lg)">
            <PageHeader
              title={data.fullName ?? data.email}
              description={
                <>
                  A user of{" "}
                  <Link
                    href={`/platform/tenants/${data.tenant.tenantId}`}
                    className="font-medium hover:text-primary"
                  >
                    {data.tenant.brandName ?? data.tenant.slug ?? "an unnamed tenant"}
                  </Link>
                  . Everything on this page is scoped to that restaurant.
                </>
              }
              meta={
                <span className="flex flex-wrap items-center gap-(--space-sm)">
                  {/*
                    `PageHeader` owns the visible <h1> and takes no test id — the primitive exists
                    to stop the product growing a sixty-first hand-written heading — so the
                    machine-readable anchor lives here. `aria-hidden` because the heading beside it
                    already announces the name and a second copy would say it twice.
                  */}
                  <span className="sr-only" aria-hidden="true" data-testid="user-detail-email">
                    {data.email}
                  </span>
                  <span className="font-mono text-small text-foreground-tertiary">
                    {data.email}
                  </span>
                </span>
              }
            />

            <SectionRail />

            <UserIdentityPanel user={data} />
            <UserLifecycleActions user={data} />
            <UserAccessPanel user={data} />
            <UserAuditPanel userId={userId} who={data.fullName ?? data.email} />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

const SECTIONS = [
  { href: "#identity", label: "Person" },
  { href: "#actions", label: "Account actions" },
  { href: "#access", label: "Access" },
  { href: "#trail", label: "Accountability" },
] as const;

/**
 * Jump links for the four panels.
 *
 * <p>Deliberately not `SectionTabs`, which is a ROUTE strip: it reads `usePathname` and marks a tab
 * current by prefix, so on a single route every one of these would render as the active tab. These
 * are fragment links into one document, in the eyebrow voice the console uses everywhere, and each
 * target carries `scroll-mt` so a jumped-to heading does not land under the platform header.
 */
function SectionRail() {
  return (
    <nav
      aria-label="User sections"
      data-testid="user-section-rail"
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

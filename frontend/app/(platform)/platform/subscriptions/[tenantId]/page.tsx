"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsoleNote } from "@/components/platform/console-section";
import { SubscriptionLifecycleActions } from "@/components/platform/subscription-lifecycle-actions";
import { TenantStatusBadge, TierBadge } from "@/components/platform/tenant-badges";
import { TenantSubscriptionPanel } from "@/components/platform/tenant-subscription-panel";
import { usePlatformTenant } from "@/lib/hooks/use-platform-tenants";

/**
 * URL: `/platform/subscriptions/{tenantId}` — one tenant's commercial arrangement, and every lever.
 *
 * <h3>Why this is its own route rather than a section of the tenant screen</h3>
 *
 * The tenant screen already carries a read-only subscription panel, and it should: an operator about
 * to suspend a restaurant needs to see what it is paying for. But the tenant screen is nine panels
 * about whether a restaurant can trade, and the five writes on this page are about a commercial
 * record that changes none of that. Putting them there would put "Cancel subscription" one scroll
 * from "Cancel tenant" — two controls with the same verb, one of which takes a kitchen offline.
 *
 * <p>Arriving here from the register also means the operator got here by asking a commercial
 * question, which is the frame this screen answers in. The link back to the tenant is on the page
 * for the moment that frame turns out to be the wrong one.
 *
 * <h3>Order: what you can do, then what is true, then what happened</h3>
 *
 * The lifecycle panel is first because it is why this route exists. The read panel below it carries
 * the current standing, the plan's ceilings measured against actual usage, and the append-only
 * history — which is the artefact that makes a tier change auditable rather than a silent
 * overwrite. Before that trail existed, `tenants.tier` was a column an operator overwrote with no
 * record of the previous value anywhere in the product: no event, no timestamp, and platform_db
 * cannot reach audit_db.
 *
 * <h3>Each panel owns its own query, its own failure and its own absence</h3>
 *
 * There is no single "subscription page" fetch. The tenant, its subscription, the plan catalogue,
 * the limit report and the history are five independent reads, and one being down must not blank the
 * other four — a control plane that goes dark because the limits endpoint is unreachable is one you
 * cannot use during an incident.
 */
export default function PlatformSubscriptionDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const tenant = usePlatformTenant(tenantId);
  const data = tenant.data;

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <Link
        href="/platform/subscriptions"
        className="inline-flex w-fit items-center gap-1.5 text-small text-foreground-secondary hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All subscriptions
      </Link>

      <QueryBoundary
        query={tenant}
        what="this tenant"
        moduleLabel="Subscriptions"
        loading={<Skeleton className="h-40" />}
      >
        {data && (
          <div className="flex flex-col gap-(--space-lg)">
            <PageHeader
              title={data.brandName}
              description="The commercial record for this restaurant group — its plan, its trial, its ceilings against real usage, and every transition that got it there."
              meta={
                <span className="flex flex-wrap items-center gap-(--space-sm)">
                  <span
                    className="sr-only"
                    aria-hidden="true"
                    data-testid="subscription-detail-name"
                  >
                    {data.brandName}
                  </span>
                  <span className="font-mono text-small text-foreground-tertiary">{data.slug}</span>
                  {/*
                    The TENANT's status, not the subscription's, and it is here deliberately. This
                    screen's whole hazard is an operator taking a commercial state for an operational
                    one, so the operational truth is stated at the top where it cannot be missed: a
                    cancelled subscription on a serving restaurant reads correctly only when both are
                    on screen together.
                  */}
                  <TenantStatusBadge status={data.status} />
                  <TierBadge tier={data.tier} />
                </span>
              }
              actions={
                <Link
                  href={`/platform/tenants/${tenantId}`}
                  className="inline-flex items-center gap-1.5 text-small font-medium text-foreground-secondary hover:text-foreground"
                  data-testid="subscription-open-tenant"
                >
                  Open the tenant
                  <ExternalLink className="size-4" aria-hidden="true" />
                </Link>
              }
            />

            <ConsoleNote data-testid="subscription-scope-note">
              The badges above are the <span className="font-medium">tenant&apos;s</span> state and
              tier — what the gateway actually enforces. Everything below is the commercial record
              laid beside it. Changing a subscription never changes whether this restaurant can take
              an order; taking it out of service is a separate decision on{" "}
              <Link
                href={`/platform/tenants/${tenantId}`}
                className="font-medium underline underline-offset-4"
              >
                its tenant page
              </Link>
              .
            </ConsoleNote>

            <SubscriptionLifecycleActions tenant={data} />
            <TenantSubscriptionPanel tenant={data} />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { FeatureMatrix } from "@/components/platform/feature-matrix";
import { UsagePanel } from "@/components/platform/usage-panel";
import { TenantStatusBadge, TierBadge } from "@/components/platform/tenant-badges";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import { TenantSubscriptionCard } from "@/components/platform/tenant-subscription-card";
import { TenantImpersonationPanel } from "@/components/platform/tenant-impersonation-panel";
import { formatUserFacingError } from "@/lib/errors";
import {
  usePlatformTenant,
  useReactivateTenant,
  useSuspendTenant,
} from "@/lib/hooks/use-platform-tenants";

/**
 * URL: /platform/tenants/{id} — one tenant, everything an operator can do to it (GA-048, GA-050).
 *
 * Provision, suspend, reactivate, edit profile, change tier and per-module toggles were all live,
 * working endpoints with no browser path at all. This is that path.
 *
 * UI-SPEC §7.5 specifies tabs (Overview · Subscription · Features · Usage · Users · Audit). One of
 * those six still has no API this console can call — there is no per-tenant user list endpoint
 * reachable from the platform plane. The Audit tab now has half its content:
 * `GET /api/v1/platform/tenants/{id}/impersonations` exists (it was a 404 when this page was
 * written, which is what GA-102 recorded) and is rendered by `TenantImpersonationPanel`. General
 * tenant audit events remain unreachable from a platform token, which carries no tenant claim and
 * is therefore refused by the tenant-facing audit endpoint — correctly.
 *
 * Rather than ship working tabs beside ones that greet the operator with an error, the panels that
 * have real data are stacked on one page. Tabs can arrive with the content that justifies them.
 */
export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const tenant = usePlatformTenant(tenantId);
  const suspend = useSuspendTenant(tenantId);
  const reactivate = useReactivateTenant(tenantId);
  const [suspendOpen, setSuspendOpen] = React.useState(false);

  const data = tenant.data;

  return (
    <div className="space-y-6">
      <Link
        href="/platform/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All tenants
      </Link>

      <QueryBoundary query={tenant} what="this tenant">
        {data && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold" data-testid="tenant-detail-name">
                  {data.brandName}
                </h1>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{data.slug}</span>
                  <TenantStatusBadge status={data.status} />
                  <TierBadge tier={data.tier} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {data.status === "SUSPENDED" ? (
                  // Reactivation restores service. It is not destructive and does not need the
                  // type-the-name gate — an accidental reactivation is undone by suspending again,
                  // whereas an accidental suspension has already taken a restaurant offline.
                  <Button
                    variant="outline"
                    disabled={reactivate.isPending}
                    data-testid="tenant-reactivate"
                    onClick={() => reactivate.mutate()}
                  >
                    {reactivate.isPending ? "Reactivating…" : "Reactivate"}
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    disabled={data.status !== "ACTIVE"}
                    data-testid="tenant-suspend"
                    onClick={() => setSuspendOpen(true)}
                  >
                    Suspend
                  </Button>
                )}
              </div>
            </header>

            {(suspend.isError || reactivate.isError) && (
              <p role="alert" className="text-sm text-destructive">
                {formatUserFacingError(suspend.error ?? reactivate.error)}
              </p>
            )}

            <TenantSubscriptionCard tenant={data} />

            <UsagePanel tenantId={tenantId} />

            <FeatureMatrix tenantId={tenantId} tenantName={data.brandName} />

            <TenantImpersonationPanel tenantId={tenantId} />

            <ConfirmDestructiveDialog
              open={suspendOpen}
              onOpenChange={setSuspendOpen}
              title={`Suspend ${data.brandName}?`}
              confirmPhrase={data.brandName}
              confirmLabel="Suspend tenant"
              reasonLabel="Reason for suspension"
              isPending={suspend.isPending}
              error={suspend.isError ? formatUserFacingError(suspend.error) : undefined}
              consequence={
                <>
                  <p>
                    Every user of <span className="font-semibold">{data.brandName}</span> is locked
                    out immediately. Orders in progress cannot be completed and the point of sale
                    stops working at all {data.maxBranches ?? "its"} branches.
                  </p>
                  <p>Nothing is deleted. Reactivating restores the tenant exactly as it was.</p>
                </>
              }
              onConfirm={(reason) =>
                suspend.mutate({ reason }, { onSuccess: () => setSuspendOpen(false) })
              }
            />
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

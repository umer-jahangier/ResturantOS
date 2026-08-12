"use client";

import * as React from "react";

import { ImpersonationResults } from "@/components/platform/impersonation-log";
import { useTenantImpersonations } from "@/lib/hooks/use-platform-impersonations";

/**
 * "Who from the platform has been inside this restaurant?" — on the tenant's own detail page.
 *
 * <h3>Why this is not the tenant's audit log</h3>
 *
 * The tenant's own OWNER can already read `IMPERSONATION_STARTED` from
 * `GET /api/v1/audit/events`, correctly scoped to their tenant. That path works and is not
 * duplicated here. This panel reads `impersonation_log` in platform_db, which is the row written
 * in the same transaction that minted the token — so it is still correct if the outbox delivery
 * that feeds the tenant's audit trail ever failed, and it is the only view the SuperAdmin, who
 * holds no tenant token, can reach at all.
 *
 * <h3>The empty state is a real answer here</h3>
 *
 * Because the API returns 404 for an unknown tenant, an empty list on this panel means exactly one
 * thing: this tenant exists and nobody has impersonated into it. That distinction is why the
 * repository does not soften the 404 — `QueryBoundary` renders the failure, not "no sessions".
 */
export function TenantImpersonationPanel({ tenantId }: { tenantId: string }) {
  const [page, setPage] = React.useState(0);
  const query = useTenantImpersonations(tenantId, page);

  return (
    <section className="space-y-3" aria-labelledby="impersonations-heading">
      <div>
        <h2 id="impersonations-heading" className="text-lg font-semibold">
          Platform access to this tenant
        </h2>
        <p className="text-sm text-muted-foreground">
          Every time platform staff signed in as one of this tenant&apos;s users. The record is
          append-only and cannot be edited or deleted, including by the administrators it names.
        </p>
      </div>

      <ImpersonationResults
        query={query}
        page={page}
        onPageChange={setPage}
        showTenant={false}
        what="this tenant's impersonation history"
        emptyTitle="No platform access recorded"
        emptyDescription="No platform administrator has signed in as a user of this tenant."
      />
    </section>
  );
}

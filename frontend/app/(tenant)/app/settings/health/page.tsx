"use client";

import { Activity } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { FleetHealthList, formatLastReachable } from "@/components/ops/fleet-health-list";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { PageHeader } from "@/components/ui/page-header";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useFleetHealth } from "@/lib/hooks/ops/use-fleet-health";

/**
 * `/app/settings/health` — the operator health surface (S1-09).
 *
 * <h3>What was missing</h3>
 *
 * There was no health route anywhere under `app/(tenant)/app/`. The directory held crm, dashboard,
 * finance, hr, inventory, kitchen, menu, nlq, pos, profile, purchasing, reports, settings,
 * stations, tables, terminals and users — and nothing that could answer "is the software running".
 * The 2026-08-12 register recorded a signed-in manager taking `503 SERVICE_UNAVAILABLE` on the
 * till, the kitchen board, the customer file and payroll simultaneously, with the product's only
 * explanation being a generic error. The owner's sole recourse was to telephone someone who could
 * run `ps`.
 *
 * <h3>Two properties this screen must have, and the failure each one prevents</h3>
 *
 * <p><b>It refreshes itself.</b> The whole point is watching a service come back. A screen that
 * needs a reload to notice recovery teaches the operator that it lags reality, and it will not be
 * opened again. `useFleetHealth` polls every 5s and the gateway probes every 5s underneath it.
 *
 * <p><b>Its own failure is never an empty list.</b> If the gateway itself cannot be reached, this
 * page renders the shared error notice — not a page of zero services, which would read as "your
 * fleet is empty" and is exactly the GA-001 lie in its most ironic possible location. That is why
 * the list goes through `QueryBoundary`, which checks error before empty by construction.
 */
function ServiceHealthPage() {
  const fleetQuery = useFleetHealth();
  const fleet = fleetQuery.data;
  const failing = fleet?.services.filter((s) => s.state !== "UP") ?? [];
  const total = fleet?.services.length ?? 0;

  return (
    /*
     * ZONE: expressive — the same zone `/app/settings` itself declares (D-34-02), so the two
     * screens read as one area rather than as a settings page and a stray console.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Service health"
        description="Whether each part of RestaurantOS is answering right now, and when it last did. Nothing here is restaurant data — it is the software itself."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="fleet-health-refresh"
            onClick={() => void fleetQuery.refetch()}
            disabled={fleetQuery.isFetching}
          >
            {fleetQuery.isFetching ? "Checking…" : "Check now"}
          </Button>
        }
      />

      {/*
        The one honest figure this screen holds, as a Meter rather than as a StatTile.
        `Meter`'s denominator is REQUIRED (D-38-16 in the compiler) and "services answering" has
        a real one — the routed fleet size — where a bare "8" would not say out of what. It is
        rendered only once the fleet has actually been read: before that there is no numerator
        and no denominator, and an empty meter reading 0/0 would be the GA-001 lie this screen
        was built to end.

        Colour is not the only channel: the status carries a WORD ("All answering" / "N down")
        beside the tone, per D-38-13.
      */}
      {fleet && (
        <Meter
          label="Services answering"
          value={total - failing.length}
          of={total}
          noun="services"
          size="md"
          status={
            failing.length === 0
              ? { tone: "success", label: "All answering" }
              : {
                  tone: "danger",
                  label: `${failing.length} not answering`,
                }
          }
        />
      )}

      {/*
        The headline, and it is deliberately a role="status" rather than role="alert": a screen
        reader user who opens this page is already looking, and an alert would interrupt them
        every five seconds as the poll lands. The alert belongs on the screens where the outage
        arrives unannounced — the till, the kitchen board — not on the one they opened to read it.
      */}
      {fleet && (
        <div
          role="status"
          data-testid="fleet-health-summary"
          data-failing={failing.length}
          className="rounded-lg border p-4 text-small"
        >
          {failing.length === 0 ? (
            <p className="font-medium">All {total} services are answering.</p>
          ) : (
            <p className="font-medium text-destructive">
              {failing.length} of {total} services{" "}
              {failing.length === 1 ? "is not answering" : "are not answering"}:{" "}
              {failing.map((s) => s.name).join(", ")}.
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            Last checked {formatLastReachable(fleet.checkedAt)}. This page updates on its own — you
            do not need to reload it.
          </p>
        </div>
      )}

      <QueryBoundary
        query={fleetQuery}
        what="service health"
        moduleLabel="Service health"
        isEmpty={total === 0}
        empty={
          <EmptyState
            icon={Activity}
            title="No services are routed"
            description="This gateway has no service routes configured, so there is nothing to report on. That is a deployment problem rather than a restaurant one — contact whoever runs your installation."
          />
        }
      >
        {fleet && <FleetHealthList fleet={fleet} />}
      </QueryBoundary>
    </ZoneProvider>
  );
}

export default function Page() {
  return (
    <PermissionGuard
      require="ops.health.view"
      fallback={
        <AccessDenied
          title="Access denied"
          description="Service health is visible to an owner or a tenant administrator. If a screen is not working, tell one of them what you were trying to do."
        />
      }
    >
      <ServiceHealthPage />
    </PermissionGuard>
  );
}

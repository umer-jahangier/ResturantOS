"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import {
  useClearFeatureOverride,
  useSetTenantFeature,
  useTenantFeatures,
} from "@/lib/hooks/use-platform-features";
import { featureSourceLabel, type FeatureState } from "@/lib/models/platform.model";

/**
 * Per-tenant module control with visible provenance (UI-SPEC §7.5, 19c).
 *
 * <h3>The distinction this table exists to draw</h3>
 *
 * The spec is explicit: *"'Inherit tier (on)' and 'Force on' must be visually distinguishable at a
 * glance, because the difference determines what happens when the tenant's plan changes."* Until
 * this phase the API made that impossible — it returned `code → boolean`, so a module an operator
 * deliberately revoked and one the tier never included were the same `false`.
 *
 * Now every row states which it is, and — where an override diverges from the tier — what it is
 * diverging FROM. An operator can see at a glance which of their decisions the next tier change
 * will respect and which values will move.
 *
 * <h3>Inherited rows are muted; overridden rows are solid and carry a revert control</h3>
 *
 * Exactly as the spec asks. The revert is not decoration: every toggle marks the row as an
 * override, permanently excluding it from tier reconciliation, so without a way back a mis-click
 * silently pins a module against every future upgrade and downgrade.
 *
 * <h3>Disabling a module is a destructive action</h3>
 *
 * It makes the module's screens disappear for every user of that tenant on their next request —
 * the gateway answers 403 FEATURE_DISABLED via `RouteFeatureMap`. So turning one OFF goes through
 * the type-the-name confirmation. Turning one ON does not: granting access is recoverable by
 * turning it off again, and gating it behind the same ceremony would train operators to type past
 * the dialog.
 */
export function FeatureMatrix({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const features = useTenantFeatures(tenantId);
  const setFeature = useSetTenantFeature(tenantId);
  const clearOverride = useClearFeatureOverride(tenantId);
  const [pendingDisable, setPendingDisable] = React.useState<FeatureState | null>(null);

  const states = features.data?.states ?? [];

  return (
    <section className="space-y-3" aria-labelledby="modules-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="modules-heading" className="text-lg font-semibold">
          Modules
        </h2>
        {features.data && (
          <p className="text-sm text-muted-foreground">
            Defaults shown for the <span className="font-medium">{features.data.tier}</span> tier
          </p>
        )}
      </div>

      <QueryBoundary query={features} what="this tenant's modules">
        <div className="overflow-hidden rounded-lg border">
          {/* `table-stack` (globals.css): four columns, one of them a pair of buttons. */}
          <table className="table-stack w-full text-sm" data-testid="feature-matrix">
            <caption className="sr-only">
              Modules for {tenantName}, showing whether each value comes from the tenant&apos;s tier
              or from an explicit override
            </caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Module
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Source
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {states.map((state) => (
                <FeatureRow
                  key={state.code}
                  state={state}
                  isBusy={setFeature.isPending || clearOverride.isPending}
                  onEnable={() => setFeature.mutate({ code: state.code, enabled: true })}
                  onRequestDisable={() => setPendingDisable(state)}
                  onRevert={() => clearOverride.mutate({ code: state.code })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </QueryBoundary>

      {(setFeature.isError || clearOverride.isError) && (
        <p role="alert" className="text-sm text-destructive">
          The change was refused and nothing was altered. Try again, or check that this tenant is
          still active.
        </p>
      )}

      <ConfirmDestructiveDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => !open && setPendingDisable(null)}
        title={`Disable ${pendingDisable?.code ?? ""}?`}
        confirmPhrase={tenantName}
        confirmLabel="Disable module"
        isPending={setFeature.isPending}
        consequence={
          <>
            <p>
              Every user of <span className="font-semibold">{tenantName}</span> loses access to this
              module immediately — its screens stop loading and its API calls are refused on the
              next request.
            </p>
            <p>
              Nothing is deleted. All of the module&apos;s existing records are kept and re-enabling
              restores them exactly.
            </p>
            {pendingDisable?.tierDefault && (
              <p>
                This tenant&apos;s tier includes this module, so disabling it records a deliberate
                override that will survive future tier changes.
              </p>
            )}
          </>
        }
        onConfirm={() => {
          if (!pendingDisable) return;
          setFeature.mutate(
            { code: pendingDisable.code, enabled: false },
            { onSettled: () => setPendingDisable(null) },
          );
        }}
      />
    </section>
  );
}

function FeatureRow({
  state,
  isBusy,
  onEnable,
  onRequestDisable,
  onRevert,
}: {
  state: FeatureState;
  isBusy: boolean;
  onEnable: () => void;
  onRequestDisable: () => void;
  onRevert: () => void;
}) {
  const overridden = state.isOverride;

  return (
    <tr
      className="border-t"
      data-testid={`feature-row-${state.code}`}
      data-source={state.source}
      data-enabled={state.enabled}
    >
      <th scope="row" className="px-4 py-2.5 text-left font-normal">
        {state.code}
      </th>

      <td className="px-4 py-2.5" data-label="State">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
            // An inherited value is muted outline; an explicit one is solid. That contrast IS the
            // spec's "distinguishable at a glance" requirement, not a stylistic preference.
            state.enabled
              ? overridden
                ? "border-success/40 bg-success/20 text-success"
                : "border-border bg-transparent text-muted-foreground"
              : overridden
                ? "border-destructive/40 bg-destructive/20 text-destructive"
                : "border-border bg-transparent text-muted-foreground",
          )}
        >
          {state.enabled ? "On" : "Off"}
        </span>
      </td>

      <td className="px-4 py-2.5" data-label="Source">
        <div className="flex flex-col gap-0.5">
          <span
            className={cn(
              "text-xs",
              overridden ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {featureSourceLabel(state)}
          </span>
          {overridden && state.enabled !== state.tierDefault && (
            <span className="text-xs text-muted-foreground">
              Tier default: {state.tierDefault ? "on" : "off"} — this override survives a tier
              change
            </span>
          )}
          {state.source === "UNSEEDED" && (
            <span className="text-xs text-muted-foreground">
              No record for this tenant; treated as off until the next tier change
            </span>
          )}
        </div>
      </td>

      <td className="px-4 py-2.5" data-label="Actions">
        <div className="flex items-center justify-end gap-2">
          {overridden && (
            <Button
              variant="ghost"
              size="xs"
              disabled={isBusy}
              onClick={onRevert}
              data-testid={`feature-revert-${state.code}`}
              title="Return this module to tier control"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Revert
            </Button>
          )}
          {state.enabled ? (
            <Button
              variant="outline"
              size="xs"
              disabled={isBusy}
              onClick={onRequestDisable}
              data-testid={`feature-disable-${state.code}`}
            >
              Disable
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={isBusy}
              onClick={onEnable}
              data-testid={`feature-enable-${state.code}`}
            >
              Enable
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

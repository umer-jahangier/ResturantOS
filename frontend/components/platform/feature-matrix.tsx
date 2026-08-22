"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { TierBadge } from "@/components/platform/tenant-badges";
import { formatNumber } from "@/lib/format/locale";
import {
  useClearFeatureOverride,
  useSetTenantFeature,
  useTenantFeatures,
} from "@/lib/hooks/use-platform-features";
import { featureSourceLabel, type FeatureState } from "@/lib/models/platform.model";

const PROVENANCE_OPTIONS = [
  { value: "override", label: "Operator overrides" },
  { value: "tier", label: "Tier defaults" },
] as const;

/**
 * Per-tenant module control with visible provenance (UI-SPEC §7.5).
 *
 * <h3>The distinction this panel exists to draw</h3>
 *
 * The spec is explicit: *"'Inherit tier (on)' and 'Force on' must be visually distinguishable at a
 * glance, because the difference determines what happens when the tenant's plan changes."* Until the
 * API grew `featureStates` that was impossible — it returned `code → boolean`, so a module an
 * operator deliberately revoked and one the tier never included arrived as the same `false`.
 *
 * Now every row states which it is, and — where an override diverges from the tier — what it is
 * diverging FROM. An operator can see at a glance which of their decisions the next tier change will
 * respect and which values will move.
 *
 * <h3>Why this is a row list and not `DataGrid`</h3>
 *
 * `DataGrid` fixes one row height per table, which is its whole point and is wrong here: a row
 * carrying a state chip, a two-line provenance explanation and two buttons is a control, not a data
 * row. It is the same reasoning the impersonation log records. What the grid's language contributes
 * — uppercase letter-spaced headings, hairline separators, a mono identifier column — is kept.
 *
 * <h3>Disabling a module is destructive; enabling one is not</h3>
 *
 * Turning a module off makes its screens disappear for every user of that tenant on their next
 * request — the gateway answers 403 FEATURE_DISABLED. So it goes through the type-the-name
 * confirmation. Turning one ON does not: granting access is undone by turning it off again, and
 * gating both behind the same ceremony would train operators to type past the dialog.
 *
 * <h3>Reverting is not decoration</h3>
 *
 * Every toggle marks the row as an override, permanently excluding it from tier reconciliation. So
 * without a way back, a mis-click silently pins a module against every future upgrade and downgrade
 * — the tenant then sits on a plan whose modules do not match it, and nothing says why.
 */
export function FeatureMatrix({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const features = useTenantFeatures(tenantId);
  const setFeature = useSetTenantFeature(tenantId);
  const clearOverride = useClearFeatureOverride(tenantId);

  const [pendingDisable, setPendingDisable] = React.useState<FeatureState | null>(null);
  const [provenance, setProvenance] = React.useState("");
  const [search, setSearch] = React.useState("");

  const states = React.useMemo(() => features.data?.states ?? [], [features.data]);
  const overrideCount = states.filter((state) => state.isOverride).length;

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return states.filter((state) => {
      if (provenance === "override" && !state.isOverride) return false;
      if (provenance === "tier" && state.isOverride) return false;
      if (needle && !state.code.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [states, provenance, search]);

  const busy = setFeature.isPending || clearOverride.isPending;

  return (
    <ConsoleSection
      anchorId="modules"
      eyebrow="Modules"
      title="Feature flags and their provenance"
      description="What this tenant can reach, and — for every code — whether that came from its tier or from a decision somebody made."
      data-testid="tenant-modules"
      action={
        features.data ? (
          <span className="flex items-center gap-1.5 text-small text-foreground-secondary">
            Defaults for <TierBadge tier={features.data.tier} />
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-(--space-md)">
        <QueryBoundary
          query={features}
          what="this tenant's modules"
          loading={<Skeleton className="h-40" />}
        >
          <>
            <FilterBar
              variant="bare"
              search={{
                value: search,
                onChange: setSearch,
                label: "Search module codes",
                placeholder: "FEATURE_…",
              }}
              filters={[
                {
                  id: "provenance",
                  label: "Provenance",
                  value: provenance,
                  onChange: setProvenance,
                  options: PROVENANCE_OPTIONS,
                  allLabel: "Everything",
                  testId: "feature-filter-provenance",
                },
              ]}
              onClearAll={() => {
                setProvenance("");
                setSearch("");
              }}
            />

            <p
              className="mb-(--space-sm) text-small text-foreground-secondary"
              data-testid="feature-matrix-counts"
            >
              <span className="font-medium text-foreground">
                {formatNumber(states.length)} module{states.length === 1 ? "" : "s"}
              </span>
              {": "}
              {formatNumber(overrideCount)} carry an operator override and survive the next tier
              change; {formatNumber(states.length - overrideCount)} follow the tier and will move
              with it.
            </p>

            <ul
              className="divide-y divide-border overflow-hidden rounded-lg border border-border"
              data-testid="feature-matrix"
            >
              {rows.map((state) => (
                <FeatureRow
                  key={state.code}
                  state={state}
                  isBusy={busy}
                  onEnable={() => setFeature.mutate({ code: state.code, enabled: true })}
                  onRequestDisable={() => setPendingDisable(state)}
                  onRevert={() => clearOverride.mutate({ code: state.code })}
                />
              ))}
              {rows.length === 0 && (
                <li className="p-(--space-md) text-small text-foreground-secondary">
                  No module matches these filters. {formatNumber(states.length)} exist for this
                  tenant.
                </li>
              )}
            </ul>
          </>
        </QueryBoundary>

        {(setFeature.isError || clearOverride.isError) && (
          <p role="alert" className="text-small text-destructive">
            The change was refused and nothing was altered. Try again, or check that this tenant is
            still active.
          </p>
        )}

        <ConsoleNote>
          Every toggle here marks the row as an override, by design: an operator touching a flag is
          making a decision, and that decision outranks the tier default from then on. Revert hands
          the code back to tier control and resets it to whatever the current tier grants.
        </ConsoleNote>
      </div>

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
                override that will survive future tier changes until somebody reverts it.
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
    </ConsoleSection>
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
    <li
      className="flex flex-wrap items-start justify-between gap-(--space-md) p-(--space-md)"
      data-testid={`feature-row-${state.code}`}
      data-source={state.source}
      data-enabled={state.enabled}
    >
      <div className="min-w-0 flex-1">
        {/* Mono, because a module code is an identifier an operator copies into a grep. */}
        <p className="font-mono text-small font-medium text-foreground">{state.code}</p>
        <p
          className={cn(
            "text-label",
            overridden ? "font-semibold text-foreground" : "text-foreground-tertiary",
          )}
        >
          {featureSourceLabel(state)}
        </p>
        {overridden && state.enabled !== state.tierDefault && (
          <p className="text-label text-foreground-tertiary">
            Tier default: {state.tierDefault ? "on" : "off"} — this override survives a tier change
          </p>
        )}
        {state.source === "UNSEEDED" && (
          <p className="text-label text-foreground-tertiary">
            No record for this tenant; treated as off until the next tier change backfills it
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-(--space-sm)">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-label font-semibold",
            // An inherited value is a muted outline; an explicit one is solid. That contrast IS the
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
    </li>
  );
}

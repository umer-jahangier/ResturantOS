"use client";

import * as React from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import { ConsoleFact, ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { TierBadge } from "@/components/platform/tenant-badges";
import { formatUserFacingError } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useChangeTier, useUpdateTenant } from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant, TenantTier } from "@/lib/models/platform.model";

const TIERS: ReadonlyArray<{ value: TenantTier; label: string }> = [
  { value: "STARTER", label: "Starter" },
  { value: "GROWTH", label: "Growth" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "CUSTOM", label: "Custom" },
];

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * The tenant's editable profile, and the one control that moves its entitlements.
 *
 * <h3>Two operations, deliberately not one form</h3>
 *
 * `PATCH /tenants/{id}` edits fields nothing enforces: a brand name, a billing reference, two
 * dates. `POST /tenants/{id}/tier` re-applies every entitlement ceiling and reconciles every module
 * row against the new tier's defaults. The backend keeps them apart for that reason — there is
 * deliberately no `tier` field on the patch body — and this panel keeps them visually apart for the
 * same one, so nobody re-tiers a restaurant while correcting a typo in its name.
 *
 * <h3>The 409 is the interesting outcome, not an error to swallow</h3>
 *
 * A downgrade below current usage is refused with `409 TIER_LIMIT_EXCEEDED`, naming the limit and
 * the usage. The refusal is surfaced verbatim beside a "downgrade anyway" control, because the
 * refusal is the safety feature and the override is a decision an operator is entitled to make
 * knowingly. Hiding either would be wrong: an unexplained failure teaches the operator to distrust
 * the screen, and a silent force teaches them the check does not exist.
 *
 * <p>Only MEASURABLE dimensions can produce that refusal, and most of them are not measurable in
 * this product. A tier change that goes through unopposed is not evidence that the tenant fits —
 * the plan-limits panel states which ceilings could actually be checked, and this one says so
 * before the operator clicks rather than after.
 *
 * <h3>Why the trial and renewal dates are here and not on the subscription panel</h3>
 *
 * They are columns on the TENANT row, edited by this patch, and they predate the subscription
 * registry — they are not the same fields as `trialEndAt` / `currentPeriodEndAt` on a subscription
 * record. Two things that look identical and are stored in different places is exactly the trap
 * worth labelling, so each one says which surface owns it.
 */
export function TenantConfigurationPanel({ tenant }: { tenant: PlatformTenant }) {
  const update = useUpdateTenant(tenant.id);
  const changeTier = useChangeTier(tenant.id);

  const [editing, setEditing] = React.useState(false);
  const [brandName, setBrandName] = React.useState(tenant.brandName);
  const [billingRef, setBillingRef] = React.useState(tenant.billingRef ?? "");
  const [trialEndsAt, setTrialEndsAt] = React.useState(toDateInput(tenant.trialEndsAt));
  const [renewsAt, setRenewsAt] = React.useState(toDateInput(tenant.renewsAt));
  const [targetTier, setTargetTier] = React.useState<TenantTier>(tenant.tier);
  const [tierConfirmOpen, setTierConfirmOpen] = React.useState(false);

  // Non-null only after a refusal. Holding the message rather than re-reading `changeTier.error`
  // at render keeps the "apply anyway" control on screen while the forced retry is in flight.
  const tierRefusal = changeTier.isError ? formatUserFacingError(changeTier.error) : null;

  const direction = tierDirection(tenant.tier, targetTier);

  return (
    <ConsoleSection
      anchorId="configuration"
      eyebrow="Configuration"
      title="Profile and tier"
      description="The fields an operator maintains by hand, and the control that re-applies what the tenant is entitled to."
      data-testid="tenant-configuration"
      action={
        <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          {editing ? "Cancel" : "Edit"}
        </Button>
      }
    >
      <div className="flex flex-col gap-(--space-lg)">
        {editing ? (
          <div className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brand-name-edit">Brand name</Label>
              <Input
                id="brand-name-edit"
                value={brandName}
                data-testid="brand-name-input"
                onChange={(e) => setBrandName(e.target.value)}
              />
              <p className="text-label text-muted-foreground">
                Display only. The slug was derived from the original name and cannot be changed —
                login resolves tenants by it and nothing propagates a rename.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billing-ref">Billing reference</Label>
              <Input
                id="billing-ref"
                value={billingRef}
                data-testid="billing-ref-input"
                onChange={(e) => setBillingRef(e.target.value)}
              />
              <p className="text-label text-muted-foreground">
                Free text for your own records. Nothing in this product reads it: there is no
                billing system on the other end of it.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trial-ends-at">Trial ends</Label>
              <Input
                id="trial-ends-at"
                type="date"
                value={trialEndsAt}
                data-testid="trial-ends-at-input"
                onChange={(e) => setTrialEndsAt(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="renews-at">Renews on</Label>
              <Input
                id="renews-at"
                type="date"
                value={renewsAt}
                data-testid="renews-at-input"
                onChange={(e) => setRenewsAt(e.target.value)}
              />
              <p className="text-label text-muted-foreground">
                A note on the tenant row. It does not gate access and no scheduler acts on it.
              </p>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <div>
                <Button
                  disabled={update.isPending}
                  data-testid="subscription-save"
                  onClick={() =>
                    update.mutate(
                      {
                        brandName: brandName.trim() || undefined,
                        billingRef: billingRef.trim() || undefined,
                        // A date input yields `YYYY-MM-DD`; the API wants an instant. Midnight UTC
                        // is used explicitly rather than the browser's local midnight, so the
                        // stored date does not shift by a day depending on who edited it.
                        trialEndsAt: trialEndsAt
                          ? new Date(`${trialEndsAt}T00:00:00Z`).toISOString()
                          : undefined,
                        renewsAt: renewsAt
                          ? new Date(`${renewsAt}T00:00:00Z`).toISOString()
                          : undefined,
                      },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                >
                  {update.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
              {update.isError && (
                <p role="alert" className="text-small text-destructive">
                  {formatUserFacingError(update.error)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
            <ConsoleFact label="Brand name" value={tenant.brandName} />
            <ConsoleFact
              label="Billing reference"
              value={tenant.billingRef ?? undefined}
              absence="Not set"
              mono
            />
            <ConsoleFact
              label="Trial ends (tenant row)"
              value={tenant.trialEndsAt ? formatDateTime(tenant.trialEndsAt, DATE_ONLY) : undefined}
              absence="No trial recorded"
            />
            <ConsoleFact
              label="Renews (tenant row)"
              value={tenant.renewsAt ? formatDateTime(tenant.renewsAt, DATE_ONLY) : undefined}
              absence="Not set"
            />
          </dl>
        )}

        <div className="flex flex-col gap-(--space-sm) border-t border-border pt-(--space-md)">
          <p className="text-label font-semibold tracking-eyebrow text-foreground-secondary uppercase">
            Tier
          </p>
          <div className="flex flex-wrap items-end gap-(--space-sm)">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target-tier">Move to</Label>
              <Select
                id="target-tier"
                className="w-44"
                value={targetTier}
                data-testid="target-tier-select"
                onValueChange={(value) => setTargetTier(value as TenantTier)}
                options={TIERS}
              />
            </div>
            <Button
              variant="outline"
              disabled={targetTier === tenant.tier || changeTier.isPending}
              data-testid="change-tier-submit"
              onClick={() => setTierConfirmOpen(true)}
            >
              {changeTier.isPending ? "Applying…" : `Move to ${targetTier}`}
            </Button>
            <span className="flex items-center gap-1.5 text-small text-foreground-secondary">
              Currently <TierBadge tier={tenant.tier} />
            </span>
          </div>

          <p className="text-small text-foreground-secondary">
            Re-applies the tier&apos;s four ceilings —{" "}
            {tenant.maxBranches === null
              ? "branches"
              : `${formatNumber(tenant.maxBranches)} branches`}
            , {tenant.maxUsers === null ? "users" : `${formatNumber(tenant.maxUsers)} users`},
            storage and NLQ quota — and reconciles every module against the new tier&apos;s
            defaults. Modules an operator overrode explicitly are left exactly where they are, in
            both directions. Nothing is deleted.
          </p>

          {tierRefusal && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/15 p-3 text-small"
              data-testid="tier-refusal"
            >
              <p>{tierRefusal}</p>
              <p className="text-foreground-secondary">
                The refusal is the safety check working: this tenant measurably exceeds a ceiling of
                the tier you chose. Forcing it applies the tier anyway — the tenant keeps everything
                it already has and is simply over its limit, which the plan-limits panel will then
                report.
              </p>
              <div>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="change-tier-force"
                  onClick={() => changeTier.mutate({ tier: targetTier, force: true })}
                >
                  Apply {targetTier} anyway
                </Button>
              </div>
            </div>
          )}

          {changeTier.isSuccess && changeTier.data && (
            <p
              className="text-small text-foreground-secondary"
              data-testid="tier-change-result"
              role="status"
            >
              Moved from {changeTier.data.previousTier} to {changeTier.data.tier}.{" "}
              {changeTier.data.changedFeatureCodes.length === 0
                ? "No module changed state."
                : `${formatNumber(changeTier.data.changedFeatureCodes.length)} module(s) changed: ${changeTier.data.changedFeatureCodes.join(", ")}.`}{" "}
              {changeTier.data.forcedOverLimits
                ? "Applied over the tier's limits at your instruction."
                : ""}
            </p>
          )}

          {!tierRefusal && (
            <ConsoleNote>
              A tier change that is not refused is not proof the tenant fits. Only measurable
              dimensions can produce a refusal, and in this product that is the branch count —
              storage, monthly orders and POS terminals have no meter the platform plane can read.
              The plan-limits panel below names which is which.
            </ConsoleNote>
          )}
        </div>
      </div>

      <ConfirmDestructiveDialog
        open={tierConfirmOpen}
        onOpenChange={setTierConfirmOpen}
        title={`Move ${tenant.brandName} to ${targetTier}?`}
        confirmPhrase={tenant.brandName}
        confirmLabel={`Move to ${targetTier}`}
        isPending={changeTier.isPending}
        data-testid="confirm-tier-change"
        consequence={
          <>
            <p>
              <span className="font-semibold">{tenant.brandName}</span> moves from {tenant.tier} to{" "}
              {targetTier}. Every entitlement ceiling is re-stamped from the new tier and every
              module the tenant has not explicitly overridden is reconciled to the new tier&apos;s
              default — so screens can appear or disappear for that restaurant&apos;s staff on their
              next request.
            </p>
            {direction === "down" && (
              <p>
                This is a <span className="font-semibold">downgrade</span>. Modules the lower tier
                does not include are switched off, and the tenant keeps every record belonging to
                them — a downgrade gates, it never deletes. If the tenant is measurably over a
                ceiling, the change is refused and you will be offered the override.
              </p>
            )}
            {direction === "up" && (
              <p>
                This is an <span className="font-semibold">upgrade</span>. Modules the higher tier
                includes are switched on for every user of this tenant. Anything an operator
                deliberately revoked stays revoked.
              </p>
            )}
            {direction === "unranked" && (
              <p>
                One side of this move is <span className="font-semibold">CUSTOM</span>, which has no
                fixed place above or below the others — its ceilings and its modules are whatever
                the matrix says for it, so this is neither an upgrade nor a downgrade in any general
                sense. Check the ceilings the result reports and the plan-limits panel afterwards
                rather than assuming a direction.
              </p>
            )}
          </>
        }
        onConfirm={() =>
          changeTier.mutate({ tier: targetTier }, { onSuccess: () => setTierConfirmOpen(false) })
        }
      />
    </ConsoleSection>
  );
}

/** `Date` → the `YYYY-MM-DD` a date input requires, in UTC so it matches what was stored. */
function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

/**
 * Which way a tier move goes — and an honest "no idea" for the one that has no direction.
 *
 * <h3>Why `CUSTOM` is unranked rather than last</h3>
 *
 * `TenantEntity.TierType` lists STARTER, GROWTH, ENTERPRISE, CUSTOM in that order, and reading the
 * enum's declaration order as a ranking would make every move onto CUSTOM an "upgrade" and every
 * move off it a "downgrade". CUSTOM is a bespoke row in the tier matrix: its ceilings and its
 * modules are whatever was configured for it, which can be above ENTERPRISE on one dimension and
 * below STARTER on another. A confirmation dialog that told an operator "this is an upgrade" on the
 * strength of an enum's ordinal would be asserting something nobody computed.
 */
function tierDirection(from: TenantTier, to: TenantTier): "up" | "down" | "same" | "unranked" {
  const RANK: Partial<Record<TenantTier, number>> = { STARTER: 0, GROWTH: 1, ENTERPRISE: 2 };
  const a = RANK[from];
  const b = RANK[to];
  if (a === undefined || b === undefined) return from === to ? "same" : "unranked";
  if (a === b) return "same";
  return b > a ? "up" : "down";
}

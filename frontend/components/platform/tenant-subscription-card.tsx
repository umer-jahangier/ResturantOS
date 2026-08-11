"use client";

import * as React from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUserFacingError } from "@/lib/errors";
import { useChangeTier, useUpdateTenant } from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant, TenantTier } from "@/lib/models/platform.model";

const TIERS: TenantTier[] = ["STARTER", "GROWTH", "ENTERPRISE", "CUSTOM"];

/**
 * Subscription and profile editing (GA-048).
 *
 * `POST .../tenants/{id}/tier` and `PATCH .../tenants/{id}` for billingRef / trialEndsAt /
 * renewsAt both work and are exercised green by the existing Playwright journey — they simply had
 * no browser path. `TenantSubscriptionService.changeTier` even returns a `TierChangeResult` whose
 * javadoc says it carries "enough detail for a SuperAdmin UI to say so". This is that UI, and it
 * says so.
 *
 * <h3>The 409 is the interesting outcome, not an error to swallow</h3>
 *
 * A downgrade below current usage is refused with `409 TIER_LIMIT_EXCEEDED` naming the limit and
 * the usage. That refusal is surfaced verbatim beside a "downgrade anyway" control, because the
 * refusal is the safety feature and the override is a decision an operator is entitled to make
 * knowingly. Hiding either would be wrong: an unexplained failure teaches the operator to distrust
 * the screen, and a silent force teaches them the check does not exist.
 *
 * <h3>What a tier change moves, stated before it is applied</h3>
 *
 * Limits AND modules. Codes the new tier no longer covers are disabled; codes it unlocks are
 * enabled; rows an operator deliberately overrode are left exactly where they are, in both
 * directions. The result panel names the codes that actually moved, so "the tier changed" is never
 * left as an unverifiable claim.
 */
export function TenantSubscriptionCard({ tenant }: { tenant: PlatformTenant }) {
  const update = useUpdateTenant(tenant.id);
  const changeTier = useChangeTier(tenant.id);

  const [editing, setEditing] = React.useState(false);
  const [billingRef, setBillingRef] = React.useState(tenant.billingRef ?? "");
  const [renewsAt, setRenewsAt] = React.useState(toDateInput(tenant.renewsAt));
  const [targetTier, setTargetTier] = React.useState<TenantTier>(tenant.tier);

  // The refusal that offers the override. Non-null only after a 409.
  const tierRefusal = changeTier.isError ? formatUserFacingError(changeTier.error) : null;

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="subscription-heading">
      <div className="flex items-center justify-between">
        <h2 id="subscription-heading" className="text-lg font-semibold">
          Subscription
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          {editing ? "Cancel" : "Edit"}
        </Button>
      </div>

      {editing ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="billing-ref">Billing reference</Label>
            <Input
              id="billing-ref"
              value={billingRef}
              data-testid="billing-ref-input"
              onChange={(e) => setBillingRef(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="renews-at">Renews on</Label>
            <Input
              id="renews-at"
              type="date"
              value={renewsAt}
              data-testid="renews-at-input"
              onChange={(e) => setRenewsAt(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={update.isPending}
              data-testid="subscription-save"
              onClick={() =>
                update.mutate(
                  {
                    billingRef: billingRef.trim() || undefined,
                    // A date input yields `YYYY-MM-DD`; the API wants an instant. Midnight UTC is
                    // used explicitly rather than the browser's local midnight, so the stored
                    // renewal date does not shift by a day depending on who edited it.
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
            {update.isError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {formatUserFacingError(update.error)}
              </p>
            )}
          </div>
        </div>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="Billing reference" value={tenant.billingRef ?? "Not set"} />
          <Field label="Trial ends" value={formatDate(tenant.trialEndsAt)} />
          <Field label="Renews" value={formatDate(tenant.renewsAt)} />
          <Field label="Branch limit" value={String(tenant.maxBranches ?? "—")} />
          <Field label="User limit" value={String(tenant.maxUsers ?? "—")} />
          <Field label="NLQ quota" value={`${tenant.nlqQuota?.toLocaleString() ?? "—"} / month`} />
        </dl>
      )}

      <div className="border-t pt-3">
        <Label htmlFor="target-tier" className="text-sm font-medium">
          Change tier
        </Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select
            id="target-tier"
            value={targetTier}
            data-testid="target-tier-select"
            onChange={(e) => setTargetTier(e.target.value as TenantTier)}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={targetTier === tenant.tier || changeTier.isPending}
            data-testid="change-tier-submit"
            onClick={() => changeTier.mutate({ tier: targetTier })}
          >
            {changeTier.isPending ? "Applying…" : `Move to ${targetTier}`}
          </Button>
        </div>

        <p className="mt-1.5 text-xs text-muted-foreground">
          Re-applies the tier&apos;s limits and reconciles modules. Modules you overrode explicitly
          are left alone in both directions. Nothing is deleted.
        </p>

        {tierRefusal && (
          <div
            role="alert"
            className="mt-2 space-y-2 rounded-md border border-warning/30 bg-warning/15 p-3 text-sm"
            data-testid="tier-refusal"
          >
            <p>{tierRefusal}</p>
            <Button
              variant="destructive"
              size="sm"
              data-testid="change-tier-force"
              onClick={() => changeTier.mutate({ tier: targetTier, force: true })}
            >
              Apply {targetTier} anyway
            </Button>
          </div>
        )}

        {changeTier.isSuccess && changeTier.data && (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="tier-change-result">
            Moved from {changeTier.data.previousTier} to {changeTier.data.tier}.{" "}
            {changeTier.data.changedFeatureCodes.length === 0
              ? "No module changed state."
              : `${changeTier.data.changedFeatureCodes.length} module(s) changed: ${changeTier.data.changedFeatureCodes.join(", ")}.`}
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function formatDate(value: Date | null): string {
  return value ? value.toLocaleDateString() : "Not set";
}

/** `Date` → the `YYYY-MM-DD` a date input requires, in UTC so it matches what was stored. */
function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

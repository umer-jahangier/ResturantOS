"use client";

import * as React from "react";
import { Copy, PauseCircle, PlayCircle, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { InsetRow } from "@/components/ui/inset-row";
import { Label } from "@/components/ui/label";
import { ConfirmDestructiveDialog } from "@/components/platform/confirm-destructive-dialog";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatUserFacingError } from "@/lib/errors";
import { formatNumber } from "@/lib/format/locale";
import {
  useCancelTenant,
  useCloseTenant,
  useReactivateTenant,
  useRetryProvisioning,
  useSuspendTenant,
} from "@/lib/hooks/use-platform-tenants";
import type { PlatformTenant, ProvisionResult } from "@/lib/models/platform.model";

/**
 * The five transitions that change whether a restaurant can trade.
 *
 * <h3>Why this is a list of sentences and not a row of buttons</h3>
 *
 * Suspend, cancel and close all read as "stop this tenant" and all sit one click apart, but they
 * are three different decisions with three different exits: a suspension is undone by reactivating,
 * a cancellation is a commercial decision that reactivation also undoes, and a close is the one
 * state nothing in this product moves back out of — there is no un-close endpoint, and
 * `reactivate` refuses a PURGED tenant. A toolbar of five similar-width buttons makes those look
 * interchangeable, which is precisely the mistake that ends with the wrong restaurant offline.
 *
 * <p>So each transition states, before it is chosen, what stops · who it happens to · what is NOT
 * deleted · how to undo it. The unavailable ones stay on screen with the reason they are
 * unavailable, because an operator looking for "reactivate" on an ACTIVE tenant needs to be told it
 * is already active rather than left hunting for a control that was conditionally removed.
 *
 * <h3>Nothing here deletes anything, and the copy says so every time</h3>
 *
 * `closePermanently` sets a status column. It was `DELETE /tenants/{id}` answering `204 No
 * Content` — the two loudest "it is gone" signals HTTP has — for an operation that erases nothing,
 * and a console that inherited that vocabulary would have operators reporting erasures to customers
 * that never happened. Every consequence block here distinguishes "cannot be used" from "has been
 * removed", because on this control plane it is always the first one.
 *
 * <h3>The reason is the API's, not the form's</h3>
 *
 * Suspend and cancel take a mandatory `{"reason"}` and refuse a blank one; reactivate and close take
 * no body at all. The dialogs mirror that exactly — a reason field appears where a reason is
 * transmitted and is absent where it would be collected and discarded.
 *
 * <p><b>And none of these four writes a queryable audit row.</b> `platform_admin_audit` enumerates
 * five actions and every one of them is against a tenant's USERS; `TenantLifecycleService` writes a
 * status column, invalidates a Redis key and emits a log line, and that log line is the only place
 * the reason survives. That is stated on the panel rather than papered over, because an operator who
 * believes a suspension is on the trail below will look for it there during a review and conclude,
 * wrongly, that nothing happened.
 */
export function TenantLifecycleActions({ tenant }: { tenant: PlatformTenant }) {
  const suspend = useSuspendTenant(tenant.id);
  const reactivate = useReactivateTenant(tenant.id);
  const cancel = useCancelTenant(tenant.id);
  const close = useCloseTenant(tenant.id);
  const retry = useRetryProvisioning(tenant.id);

  type Pending = "suspend" | "reactivate" | "cancel" | "close" | "retry" | null;
  const [pending, setPending] = React.useState<Pending>(null);
  const [adminEmail, setAdminEmail] = React.useState("");
  const [retryResult, setRetryResult] = React.useState<ProvisionResult | null>(null);

  const status = tenant.status;
  const name = tenant.brandName;
  const branches = tenant.maxBranches === null ? null : formatNumber(tenant.maxBranches);

  const dismiss = () => setPending(null);

  return (
    <ConsoleSection
      anchorId="lifecycle"
      eyebrow="Lifecycle"
      title="Change this tenant's state"
      description={
        <>
          Each of these takes effect for every user of {name} on their next request, and none of
          them deletes anything. The reason you give travels with the request into the service log —
          these four transitions write no queryable audit row, so the operator trail at the bottom
          of this page will not show them.
        </>
      }
      data-testid="tenant-lifecycle"
    >
      <ul className="flex flex-col gap-(--space-sm)">
        <LifecycleAction
          icon={<PauseCircle className="size-4" aria-hidden="true" />}
          title="Suspend"
          available={status === "ACTIVE"}
          unavailableReason={
            status === "SUSPENDED"
              ? "Already suspended."
              : "Only an active tenant can be suspended."
          }
          summary="Locks every user out immediately and stops the point of sale. Reversed by reactivating."
          testId="tenant-suspend"
          onOpen={() => setPending("suspend")}
        />

        <LifecycleAction
          icon={<PlayCircle className="size-4" aria-hidden="true" />}
          title="Reactivate"
          available={status === "SUSPENDED" || status === "CANCELLED"}
          unavailableReason={
            status === "ACTIVE"
              ? "This tenant is already serving."
              : status === "PURGED"
                ? "A closed tenant cannot be reopened from this console."
                : "Provisioning must finish before a tenant can be reactivated."
          }
          summary="Restores service. Users sign in again on their next attempt; entitlements return to what the tier grants."
          tone="default"
          testId="tenant-reactivate"
          onOpen={() => setPending("reactivate")}
        />

        <LifecycleAction
          icon={<XCircle className="size-4" aria-hidden="true" />}
          title="Cancel"
          available={status === "ACTIVE" || status === "SUSPENDED"}
          unavailableReason={
            status === "CANCELLED"
              ? "Already cancelled."
              : "Only a live or suspended tenant can be cancelled."
          }
          summary="Takes the tenant out of service as a decision rather than an incident. Data is retained and reactivation still works."
          testId="tenant-cancel"
          onOpen={() => setPending("cancel")}
        />

        <LifecycleAction
          icon={<XCircle className="size-4" aria-hidden="true" />}
          title="Close permanently"
          available={status === "CANCELLED"}
          unavailableReason={
            status === "PURGED"
              ? "This tenant is already closed."
              : "A tenant must be cancelled before it can be closed."
          }
          summary="The one state nothing in this console moves back out of. Records are kept; the tenant can never trade again."
          testId="tenant-close"
          onOpen={() => setPending("close")}
        />

        <LifecycleAction
          icon={<RotateCcw className="size-4" aria-hidden="true" />}
          title="Retry provisioning"
          available={status === "PROVISIONING_FAILED"}
          unavailableReason={
            status === "PROVISIONING"
              ? "The saga is still running. Wait for it to settle."
              : "Only a tenant whose provisioning failed can be re-driven."
          }
          summary="Re-runs the provisioning saga on this same tenant row and mints a fresh one-time administrator password."
          tone="default"
          testId="tenant-retry-provisioning"
          onOpen={() => {
            setRetryResult(null);
            setAdminEmail("");
            setPending("retry");
          }}
        />
      </ul>

      {/*
        The credential appears exactly once and there is no second channel: notification-service has
        no source files, so no email carries it and this operator IS the delivery mechanism. It is
        rendered here rather than left in the dialog because the dialog closes on success and a
        credential that vanishes with it would leave a tenant unreachable.
      */}
      {retryResult && (
        <div
          className="mt-(--space-md) flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-(--space-md)"
          data-testid="retry-provisioning-result"
          role="status"
        >
          <p className="text-small font-medium">
            Provisioning re-ran for {name}. This password is shown once and is not stored anywhere
            you can read it again.
          </p>
          <dl className="flex flex-col gap-2">
            <div>
              <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                Administrator
              </dt>
              <dd className="font-mono text-small break-all">{retryResult.adminEmail}</dd>
            </div>
            <div>
              <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                Temporary password
              </dt>
              <dd className="flex items-center gap-2">
                {retryResult.tempPassword ? (
                  <>
                    <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-small">
                      {retryResult.tempPassword}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy temporary password"
                      onClick={() => {
                        void navigator.clipboard?.writeText(retryResult.tempPassword ?? "");
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <span className="text-small text-muted-foreground">
                    No longer available — this was a repeated request and the credential&apos;s
                    retention window has passed. Reset it from the tenant&apos;s users panel below.
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {status === "PURGED" && (
        <ConsoleNote className="mt-(--space-md)" data-testid="tenant-closed-note">
          This tenant is closed. Its records are retained for referential integrity — orders, audit
          rows and impersonation history still resolve — but no transition on this console reopens
          it, and no endpoint in this product erases it.
        </ConsoleNote>
      )}

      <ConfirmDestructiveDialog
        open={pending === "suspend"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Suspend ${name}?`}
        confirmPhrase={name}
        confirmLabel="Suspend tenant"
        reasonLabel="Reason for suspension"
        isPending={suspend.isPending}
        error={suspend.isError ? formatUserFacingError(suspend.error) : undefined}
        consequence={
          <>
            <p>
              Every user of <span className="font-semibold">{name}</span> is locked out immediately.
              Orders in progress cannot be completed and the point of sale stops working
              {branches ? ` at all ${branches} branches` : " at every branch"}.
            </p>
            <p>Nothing is deleted. Reactivating restores the tenant exactly as it was.</p>
          </>
        }
        onConfirm={(reason) => suspend.mutate({ reason }, { onSuccess: dismiss })}
      />

      <ConfirmDestructiveDialog
        open={pending === "cancel"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Cancel ${name}?`}
        confirmPhrase={name}
        confirmLabel="Cancel tenant"
        reasonLabel="Reason for cancellation"
        isPending={cancel.isPending}
        error={cancel.isError ? formatUserFacingError(cancel.error) : undefined}
        consequence={
          <>
            <p>
              <span className="font-semibold">{name}</span> stops serving and its users can no
              longer sign in. Cancellation is the commercial exit, not an incident — a suspension is
              the one to reach for if this is temporary.
            </p>
            <p>
              Nothing is deleted and reactivating still works afterwards. This does NOT cancel the
              tenant&apos;s subscription record; that is a separate decision on the subscription
              panel.
            </p>
          </>
        }
        onConfirm={(reason) => cancel.mutate({ reason }, { onSuccess: dismiss })}
      />

      <ConfirmDestructiveDialog
        open={pending === "close"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Close ${name} permanently?`}
        confirmPhrase={name}
        confirmLabel="Close permanently"
        isPending={close.isPending}
        error={close.isError ? formatUserFacingError(close.error) : undefined}
        consequence={
          <>
            <p>
              <span className="font-semibold">{name}</span> ({tenant.slug}) is taken out of service
              for good. Nothing in this console reopens it — reactivation refuses a closed tenant —
              so treat this as the end of the relationship.
            </p>
            <p>
              <span className="font-semibold">Nothing is erased.</span> The tenant row, its orders,
              its audit events and its impersonation history all remain and continue to resolve.
              This sets a status; there is no endpoint in this product that deletes a tenant&apos;s
              data.
            </p>
            <p className="text-foreground-secondary">
              This endpoint accepts no reason, so the audit row will record your account, the tenant
              and the time — and nothing about why. Record the decision wherever your team keeps
              them before you confirm.
            </p>
          </>
        }
        onConfirm={() => close.mutate(undefined, { onSuccess: dismiss })}
      />

      <ConfirmDestructiveDialog
        open={pending === "retry"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Retry provisioning for ${name}?`}
        confirmPhrase={name}
        confirmLabel="Re-run provisioning"
        isPending={retry.isPending}
        confirmDisabled={!adminEmail.includes("@")}
        error={retry.isError ? formatUserFacingError(retry.error) : undefined}
        extraFields={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retry-admin-email">Administrator email</Label>
            <Input
              id="retry-admin-email"
              type="email"
              value={adminEmail}
              autoComplete="off"
              data-testid="retry-admin-email"
              onChange={(event) => setAdminEmail(event.target.value)}
            />
            <p className="text-label text-muted-foreground">
              The account the saga will create and hand the new temporary password to. Required, and
              not a formality — an earlier version of this endpoint substituted a placeholder here
              and produced tenants whose administrator nobody could sign in as.
            </p>
          </div>
        }
        consequence={
          <>
            <p>
              The provisioning saga runs again on this same tenant row, creating the HQ branch, the
              chart of accounts and the first administrator for{" "}
              <span className="font-semibold">{name}</span>. A failure rolls the attempt back.
            </p>
            <p>
              A <span className="font-semibold">new one-time password</span> is issued and shown
              once on this screen. There is no email path in this product, so you are the delivery
              channel — have somewhere to put it before you continue.
            </p>
          </>
        }
        onConfirm={() =>
          retry.mutate(
            { adminEmail: adminEmail.trim() },
            {
              onSuccess: (result) => {
                setRetryResult(result);
                dismiss();
              },
            },
          )
        }
      />

      {/*
        Reactivation gets a plain confirmation rather than the type-the-name gate. It RESTORES
        service, and an accidental reactivation is undone by suspending again — whereas an
        accidental suspension has already taken a restaurant offline. Putting the same ceremony on
        both would teach an operator to type past the dialog, which is how the gate stops working on
        the action that needs it.
      */}
      <ConfirmDialog
        open={pending === "reactivate"}
        onOpenChange={(open) => !open && dismiss()}
        tone="neutral"
        title={`Reactivate ${name}?`}
        confirmLabel="Reactivate"
        isPending={reactivate.isPending}
        error={reactivate.isError ? formatUserFacingError(reactivate.error) : undefined}
        body={
          <>
            Users of {name} can sign in again from their next attempt, and the point of sale
            resumes. Entitlements return to whatever the tenant&apos;s current tier grants — module
            overrides an operator set are untouched. This endpoint records no reason.
          </>
        }
        onConfirm={() => reactivate.mutate(undefined, { onSuccess: dismiss })}
      />
    </ConsoleSection>
  );
}

/**
 * One transition, stated before it is offered.
 *
 * An unavailable action keeps its row and its explanation rather than disappearing: a control that
 * vanishes when it does not apply leaves the operator unsure whether they lack the permission, the
 * tenant is in the wrong state, or the console is broken.
 */
function LifecycleAction({
  icon,
  title,
  summary,
  available,
  unavailableReason,
  tone = "destructive",
  testId,
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  available: boolean;
  unavailableReason: string;
  tone?: "destructive" | "default";
  testId: string;
  onOpen: () => void;
}) {
  return (
    <InsetRow
      as="li"
      leading={<span className="text-foreground-tertiary">{icon}</span>}
      primary={title}
      secondary={available ? summary : unavailableReason}
      trailing={
        <Button
          variant={tone === "destructive" ? "destructive" : "outline"}
          size="sm"
          disabled={!available}
          data-testid={testId}
          onClick={onOpen}
        >
          {title}
        </Button>
      }
      className={available ? undefined : "opacity-70"}
    />
  );
}

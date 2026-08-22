"use client";

import * as React from "react";
import { Copy, KeyRound, LogOut, Unlock, UserCheck, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InsetRow } from "@/components/ui/inset-row";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { UserActionDialog } from "@/components/platform/user-action-dialog";
import { formatUserFacingError } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import {
  useDeactivateUser,
  useReactivateUser,
  useResetUserPassword,
  useRevokeUserSessions,
  useUnlockUser,
} from "@/lib/hooks/use-platform-access";
import type {
  AdminPasswordReset,
  PlatformUserDetail,
  UserLifecycleAction,
  UserSecurityState,
} from "@/lib/models/platform-access.model";

/**
 * The five things a platform operator can do to one person's account.
 *
 * <h3>Why this is a list of sentences and not a row of buttons</h3>
 *
 * Deactivate, revoke sessions and reset password all read as "cut this person off" and all sit one
 * click apart, but they are three different decisions with three different exits: a deactivation
 * is undone by reactivating, a session revocation is undone by the person signing in again, and a
 * password reset cannot be undone at all — the old password is gone the moment the new one is
 * minted. A toolbar of five similar-width buttons makes those look interchangeable. Each row here
 * states, before it is chosen, what changes · what does NOT · and how it is reversed.
 *
 * <h3>Every one of them takes a reason, and the reason is the API's</h3>
 *
 * All five endpoints take `{"reason": "…"}` and refuse a blank one, because each writes a row to
 * `platform_admin_audit` — append-only at the trigger layer, so this trail cannot be shown a
 * rewritten history. The acting administrator is read from the `sub` of the verified control-plane
 * token and never from anything an operator can type.
 *
 * <h3>"Access removed" is never instantaneous, and the copy never says it is</h3>
 *
 * Deactivating revokes every live REFRESH session, but already-issued ACCESS tokens are stateless
 * and there is no revocation list anywhere in this product. The residual window is the access-token
 * TTL. A console that rendered deactivation as "access removed" would have operators telling
 * customers something that is not true for another few minutes.
 *
 * <h3>The lock state is not readable from here, and that is stated rather than guessed</h3>
 *
 * `GET /platform/tenants/{t}/users/{u}` carries no `lockedUntil` and no failed-login counter — the
 * upstream summary has no such fields. So "Clear lockout" is offered unconditionally and says why:
 * the only way this console learns whether a lockout was in force is to perform the unlock and
 * read the answer, which is exactly what the result block below reports.
 */
export function UserLifecycleActions({ user }: { user: PlatformUserDetail }) {
  const tenantId = user.tenant.tenantId;
  const userId = user.userId;
  const who = user.fullName ?? user.email;

  const deactivate = useDeactivateUser(tenantId, userId);
  const reactivate = useReactivateUser(tenantId, userId);
  const unlock = useUnlockUser(tenantId, userId);
  const revoke = useRevokeUserSessions(tenantId, userId);
  const reset = useResetUserPassword(tenantId, userId);

  const [pending, setPending] = React.useState<UserLifecycleAction | null>(null);
  const [security, setSecurity] = React.useState<{
    action: "unlock" | "revoke-sessions";
    state: UserSecurityState;
  } | null>(null);
  const [credential, setCredential] = React.useState<AdminPasswordReset | null>(null);

  const dismiss = () => setPending(null);

  return (
    <ConsoleSection
      anchorId="actions"
      eyebrow="Account actions"
      title="Act on this account"
      description={
        <>
          Each of these takes effect for {who} on their next request, none of them deletes anything,
          and every one records the reason you give against your account in the trail at the bottom
          of this page.
        </>
      }
      data-testid="user-lifecycle"
    >
      <ul className="flex flex-col gap-(--space-sm)">
        <LifecycleAction
          icon={<UserX className="size-4" aria-hidden="true" />}
          title="Deactivate"
          available={user.active}
          unavailableReason="This account is already deactivated."
          summary="Turns the account off and signs it out everywhere. Roles and history are untouched; reactivating restores it."
          testId="user-deactivate"
          onOpen={() => setPending("deactivate")}
        />

        <LifecycleAction
          icon={<UserCheck className="size-4" aria-hidden="true" />}
          title="Reactivate"
          available={!user.active}
          unavailableReason="This account is already active."
          summary="Turns the account back on. Sessions are not restored — they sign in again, which is when the platform re-establishes who holds the account."
          tone="default"
          testId="user-reactivate"
          onOpen={() => setPending("reactivate")}
        />

        <LifecycleAction
          icon={<Unlock className="size-4" aria-hidden="true" />}
          title="Clear lockout"
          available
          unavailableReason=""
          summary="Clears the brute-force cooldown and its counter. Not the same as reactivating: a lockout expires by itself in fifteen minutes, deactivation does not."
          tone="default"
          testId="user-unlock"
          onOpen={() => setPending("unlock")}
        />

        <LifecycleAction
          icon={<LogOut className="size-4" aria-hidden="true" />}
          title="Revoke sessions"
          available
          unavailableReason=""
          summary="Signs the person out of every device. The account itself is untouched and they can sign straight back in."
          testId="user-revoke-sessions"
          onOpen={() => setPending("revoke-sessions")}
        />

        <LifecycleAction
          icon={<KeyRound className="size-4" aria-hidden="true" />}
          title="Reset password"
          available
          unavailableReason=""
          summary="Mints a temporary password, shown once on this screen. Their current password stops working immediately and cannot be restored."
          testId="user-reset-password"
          onOpen={() => {
            setCredential(null);
            setPending("reset-password");
          }}
        />
      </ul>

      {/*
        The result of an action whose answer the detail endpoint cannot show. `lockedUntil` and
        `failedLoginCount` are not on `GET .../users/{id}`, so this block is the ONLY place the
        console ever states them — and `sessionsRevoked: 0` is a measured zero, reported as such
        rather than replaced by a claim of success.
      */}
      {security && (
        <div
          className="mt-(--space-md) flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-(--space-md)"
          data-testid="user-security-result"
          role="status"
        >
          {security.action === "unlock" ? (
            <p className="text-small">
              <span className="font-medium">Lockout cleared.</span>{" "}
              {security.state.lockedUntil === null
                ? "There is now no lockout in force"
                : `A lockout is still recorded until ${formatDateTime(security.state.lockedUntil)}`}
              , and the failed-attempt counter reads{" "}
              <span className="font-mono tabular-nums">
                {formatNumber(security.state.failedLoginCount)}
              </span>
              . This screen cannot read either figure again — they are not on the user record the
              console fetches.
            </p>
          ) : (
            <p className="text-small">
              <span className="font-medium">
                {formatNumber(security.state.sessionsRevoked)} refresh{" "}
                {security.state.sessionsRevoked === 1 ? "session" : "sessions"} revoked.
              </span>{" "}
              {security.state.sessionsRevoked === 0
                ? "Zero is a measured answer, not a failure: this person held no live session."
                : "They are signed out of those devices."}{" "}
              Access tokens already issued keep working until they expire — there is no revocation
              list in this product — so the sign-out is not instantaneous.
            </p>
          )}
        </div>
      )}

      {/*
        The credential appears exactly once and there is no second channel: notification-service has
        no source files, so no email carries it and this operator IS the delivery mechanism. It is
        rendered out here rather than inside the dialog because the dialog closes on success, and a
        password that vanished with it would leave a person locked out of their own restaurant.
      */}
      {credential && (
        <div
          className="mt-(--space-md) flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-(--space-md)"
          data-testid="user-reset-result"
          role="status"
        >
          <p className="text-small font-medium">
            A temporary password was issued for {credential.email}. It is shown once and is stored
            nowhere you can read it again — not in the audit row, not in a log, not behind any
            endpoint.
          </p>
          <dl className="flex flex-col gap-2">
            <div>
              <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                Temporary password
              </dt>
              <dd className="flex items-center gap-2">
                {credential.tempPassword ? (
                  <>
                    <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-small">
                      {credential.tempPassword}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy temporary password"
                      onClick={() => {
                        void navigator.clipboard?.writeText(credential.tempPassword ?? "");
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <span className="text-small text-muted-foreground">
                    The reset succeeded but no credential came back with it. Run the reset again —
                    it is safe to repeat, and it mints a fresh password each time.
                  </span>
                )}
              </dd>
            </div>
            {credential.mustChangePassword === true && (
              <div>
                <dt className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                  On first use
                </dt>
                <dd className="text-small">
                  They are forced to choose a new password before they can do anything else.
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <ConsoleNote className="mt-(--space-md)">
        None of these five can grant anything. There is deliberately no role-assignment control on
        this console: composing a role is granting authority, and the tenant tier bounds that with a
        ceiling a platform operator does not have. Roles are changed by the tenant&apos;s own
        administrators.
      </ConsoleNote>

      <UserActionDialog
        open={pending === "deactivate"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Deactivate ${who}?`}
        confirmPhrase={user.email}
        confirmLabel="Deactivate account"
        reasonLabel="Reason for deactivation"
        isPending={deactivate.isPending}
        error={deactivate.isError ? formatUserFacingError(deactivate.error) : undefined}
        data-testid="user-deactivate-dialog"
        consequence={
          <>
            <p>
              <span className="font-semibold">{who}</span> ({user.email}) can no longer sign in, and
              every live refresh session is revoked. If they are mid-shift on a till, their next
              request fails.
            </p>
            <p>
              <span className="font-semibold">Nothing is deleted.</span> The account row, its roles
              and every order and audit entry referencing it stay exactly as they are, and
              reactivating restores the account.
            </p>
            <p className="text-foreground-secondary">
              Access tokens already issued keep working until they expire. There is no revocation
              list in this product, so this is not instantaneous.
            </p>
          </>
        }
        onConfirm={(reason) => deactivate.mutate({ reason }, { onSuccess: dismiss })}
      />

      <UserActionDialog
        open={pending === "reactivate"}
        onOpenChange={(open) => !open && dismiss()}
        tone="neutral"
        title={`Reactivate ${who}?`}
        confirmLabel="Reactivate account"
        reasonLabel="Reason for reactivation"
        isPending={reactivate.isPending}
        error={reactivate.isError ? formatUserFacingError(reactivate.error) : undefined}
        data-testid="user-reactivate-dialog"
        consequence={
          <>
            <p>
              <span className="font-semibold">{who}</span> can sign in again from their next
              attempt, with the roles they already held.
            </p>
            <p>
              Sessions are <span className="font-semibold">not</span> restored, deliberately: the
              ones revoked at deactivation may have been on a device this person no longer has. They
              sign in again, which is the moment the platform re-establishes who is holding the
              account.
            </p>
          </>
        }
        onConfirm={(reason) => reactivate.mutate({ reason }, { onSuccess: dismiss })}
      />

      <UserActionDialog
        open={pending === "unlock"}
        onOpenChange={(open) => !open && dismiss()}
        tone="neutral"
        title={`Clear the lockout on ${who}?`}
        confirmLabel="Clear lockout"
        reasonLabel="Reason for clearing the lockout"
        isPending={unlock.isPending}
        error={unlock.isError ? formatUserFacingError(unlock.error) : undefined}
        data-testid="user-unlock-dialog"
        consequence={
          <>
            <p>
              Clears the brute-force cooldown and its failed-attempt counter for{" "}
              <span className="font-semibold">{who}</span>. Nothing else about the account changes.
            </p>
            <p>
              This console cannot see whether a lockout is currently in force — the user record it
              reads carries no lock field. Running this when there is none is harmless: it clears a
              counter that was already zero, and the answer tells you which it was.
            </p>
            <p className="text-foreground-secondary">
              Not the same as reactivating. A lockout expires by itself after fifteen minutes; a
              deactivation does not expire at all.
            </p>
          </>
        }
        onConfirm={(reason) =>
          unlock.mutate(
            { reason },
            {
              onSuccess: (state) => {
                setSecurity({ action: "unlock", state });
                dismiss();
              },
            },
          )
        }
      />

      <UserActionDialog
        open={pending === "revoke-sessions"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Sign ${who} out everywhere?`}
        confirmLabel="Revoke sessions"
        reasonLabel="Reason for revoking sessions"
        isPending={revoke.isPending}
        error={revoke.isError ? formatUserFacingError(revoke.error) : undefined}
        data-testid="user-revoke-dialog"
        consequence={
          <>
            <p>
              Every live refresh session belonging to <span className="font-semibold">{who}</span>{" "}
              is revoked. If they are working a till right now, they are asked to sign in again.
            </p>
            <p>
              The account itself is untouched — they can sign straight back in with the same
              password. Reach for deactivation instead if the point is that they should not be able
              to.
            </p>
            <p className="text-foreground-secondary">
              Access tokens already issued survive until they expire; there is no revocation list.
              The count of sessions revoked is reported afterwards, and zero is a real answer.
            </p>
          </>
        }
        onConfirm={(reason) =>
          revoke.mutate(
            { reason },
            {
              onSuccess: (state) => {
                setSecurity({ action: "revoke-sessions", state });
                dismiss();
              },
            },
          )
        }
      />

      <UserActionDialog
        open={pending === "reset-password"}
        onOpenChange={(open) => !open && dismiss()}
        title={`Reset the password for ${who}?`}
        confirmPhrase={user.email}
        confirmLabel="Issue a temporary password"
        reasonLabel="Reason for the reset"
        isPending={reset.isPending}
        error={reset.isError ? formatUserFacingError(reset.error) : undefined}
        data-testid="user-reset-dialog"
        consequence={
          <>
            <p>
              The current password for <span className="font-semibold">{who}</span> ({user.email})
              stops working immediately and cannot be restored. A new temporary one is minted and
              shown <span className="font-semibold">once</span> on this screen.
            </p>
            <p>
              There is no email in this product, so you are the delivery channel. Have somewhere to
              put it before you continue — it is in no log, no audit row and no endpoint afterwards.
            </p>
            <p className="text-foreground-secondary">
              Safe to repeat: a second reset simply mints a second password and records a second
              row. This is the escape hatch for a restaurant that has locked itself out of its own
              highest role, which nobody inside that restaurant can fix.
            </p>
          </>
        }
        onConfirm={(reason) =>
          reset.mutate(
            { reason },
            {
              onSuccess: (result) => {
                setCredential(result);
                dismiss();
              },
            },
          )
        }
      />
    </ConsoleSection>
  );
}

/**
 * One action, stated before it is offered.
 *
 * An unavailable action keeps its row and its explanation rather than disappearing: a control that
 * vanishes when it does not apply leaves an operator unsure whether they lack the authority, the
 * account is in the wrong state, or the console is broken.
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

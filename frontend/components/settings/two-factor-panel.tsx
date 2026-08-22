"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";
import { TotpQrCode } from "@/components/auth/totp-qr-code";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useRegenerateRecoveryCodes,
  useTotpDisable,
  useTotpSetup,
  useTotpVerify,
  useTwoFactorStatus,
} from "@/lib/hooks/auth/use-totp-enrollment";
import { formatUserFacingError } from "@/lib/errors";

/**
 * Manage this account's second factor from Settings.
 *
 * <h3>Why this exists separately from the login-card enrolment</h3>
 *
 * {@code TotpEnrollment} runs unauthenticated, re-proving identity by password on every call,
 * because the user it serves is locked out and holds no token. That path is deliberately narrow:
 * it refuses once a secret exists, so it can only ever break a deadlock. Everything else a person
 * does to their own second factor — enrolling by choice, re-issuing recovery codes, turning it off
 * — needs a live session and belongs here.
 *
 * <h3>The count is the point</h3>
 *
 * A user who has silently spent eight of ten codes is two lost logins from being locked out and has
 * no way to notice. The remaining count is surfaced permanently, and drops to a warning below three,
 * because the moment to re-issue is before the last one is gone, not after.
 */
export function TwoFactorPanel() {
  const status = useTwoFactorStatus();
  const setup = useTotpSetup();
  const verify = useTotpVerify();
  const regenerate = useRegenerateRecoveryCodes();
  const disable = useTotpDisable();

  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "enrolling" | "regenerating" | "disabling">("idle");
  const [error, setError] = useState<string | null>(null);

  // `status.isSuccess`, NOT `!status.isPending`. On a failed request isPending is false and
  // `status.data` is undefined, so `?? false` reports "two-factor is OFF" for an account that may
  // well have it ON — and the panel then offers to set it up. That is the worst direction to be
  // wrong in on a security control: it tells a protected user they are unprotected, and invites
  // re-enrolment of a factor that is already live. A settings screen may say "I could not find
  // out"; it may never turn "I could not find out" into "it is off".
  const known = status.isSuccess;
  const enabled = status.data?.enabled ?? false;
  const remaining = status.data?.recoveryCodesRemaining ?? 0;
  const busy = setup.isPending || verify.isPending || regenerate.isPending || disable.isPending;

  function reset() {
    setOtpauthUri(null);
    setCode("");
    setMode("idle");
    setError(null);
  }

  // Recovery codes preempt every other view: they cannot be refetched, so nothing may be allowed to
  // navigate past them until the user has acknowledged saving them.
  if (codes) {
    return (
      <Card depth={2}>
        <CardHeader>
          <CardTitle>Recovery codes</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryCodesPanel
            codes={codes}
            continueLabel="Done"
            onAcknowledged={() => {
              setCodes(null);
              reset();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card depth={2} data-testid="two-factor-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? (
            <ShieldCheck className="size-4 text-success" aria-hidden="true" />
          ) : (
            <ShieldOff className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          {enabled
            ? "Your account asks for a code from your authenticator app when you sign in."
            : "Add a code from an authenticator app to your sign-in, so a stolen password is not enough on its own."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>That didn&apos;t work</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {status.isPending ? <p className="text-body text-muted-foreground">Checking…</p> : null}

        {status.isError ? (
          <QueryErrorNotice
            what="your two-factor status"
            error={status.error}
            onRetry={() => status.refetch()}
            isRetrying={status.isFetching}
            moduleLabel="Two-factor authentication"
            stillWorks="Your existing sign-in and authenticator app are unaffected — this panel just cannot read the current setting."
          />
        ) : null}

        {/* ---------------------------------------------------------------- enrolled */}
        {known && enabled && mode === "idle" ? (
          <>
            {remaining === 0 ? (
              <Alert variant="destructive">
                <AlertTitle>No recovery codes left</AlertTitle>
                <AlertDescription>
                  If you lose your phone now, you will not be able to sign in. Generate a new set.
                </AlertDescription>
              </Alert>
            ) : remaining < 3 ? (
              <Alert>
                <AlertTitle>
                  {remaining} recovery code{remaining === 1 ? "" : "s"} left
                </AlertTitle>
                <AlertDescription>
                  Generate a new set before you run out — the last one is not a good place to find
                  yourself.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-body text-muted-foreground" data-testid="recovery-codes-remaining">
                {remaining} unused recovery codes.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMode("regenerating")}
              >
                <KeyRound className="size-4" />
                Generate new recovery codes
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("disabling")}>
                Turn off
              </Button>
            </div>
          </>
        ) : null}

        {/* --------------------------------------------------- not enrolled: start it */}
        {known && !enabled && mode === "idle" ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setup.mutate(undefined, {
                onSuccess: (s) => {
                  setOtpauthUri(s.otpauthUri);
                  setMode("enrolling");
                },
                onError: (e) => setError(formatUserFacingError(e)),
              });
            }}
            data-testid="two-factor-start"
          >
            {setup.isPending ? "Preparing…" : "Set up two-factor authentication"}
          </Button>
        ) : null}

        {/* ------------------------------------------------ not enrolled: scan + confirm */}
        {mode === "enrolling" && otpauthUri ? (
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <p className="text-body font-medium">Scan this with your authenticator app</p>
            <TotpQrCode otpauthUri={otpauthUri} />
            <a
              href={otpauthUri}
              className="text-center text-body text-primary underline underline-offset-4"
            >
              Open in your authenticator app
            </a>
            <CodeField
              id="totp-confirm"
              label="Six-digit code from the app"
              value={code}
              onChange={setCode}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || code.length !== 6}
                onClick={() => {
                  setError(null);
                  verify.mutate(code, {
                    onSuccess: (r) => setCodes(r.recoveryCodes),
                    onError: () =>
                      setError(
                        "That code wasn't accepted. Codes change every 30 seconds — wait for the next one and try again.",
                      ),
                  });
                }}
                data-testid="two-factor-confirm"
              >
                {verify.isPending ? "Confirming…" : "Confirm"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------------------- regenerating */}
        {mode === "regenerating" ? (
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <p className="text-body">
              This replaces every existing recovery code. Any list you printed or saved before will
              stop working.
            </p>
            {/* An authenticator code, not a recovery code — enforced server-side, and said here so
                the requirement does not read as an arbitrary refusal to someone without their phone. */}
            <CodeField
              id="totp-regen"
              label="Six-digit code from your authenticator app"
              value={code}
              onChange={setCode}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || code.length !== 6}
                onClick={() => {
                  setError(null);
                  regenerate.mutate(code, {
                    onSuccess: (r) => setCodes(r.recoveryCodes),
                    onError: () =>
                      setError("That code wasn't accepted. Wait for the next one and try again."),
                  });
                }}
                data-testid="two-factor-regenerate"
              >
                {regenerate.isPending ? "Generating…" : "Generate new codes"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- disabling */}
        {mode === "disabling" ? (
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <p className="text-body">
              Turning this off means your password alone will get someone into this account. Your
              recovery codes stop working too.
            </p>
            <CodeField
              id="totp-disable"
              label="Authenticator code, or one of your recovery codes"
              value={code}
              onChange={setCode}
              // Widened for a recovery code, because the person most likely to be disabling is the
              // one whose authenticator is gone. A six-digit-only field here would ask them for
              // precisely the thing they lost.
              allowRecoveryCode
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={busy || code.trim().length < 6}
                onClick={() => {
                  setError(null);
                  disable.mutate(code.trim(), {
                    onSuccess: () => {
                      toast.success("Two-factor authentication is off.");
                      reset();
                    },
                    onError: () => setError("That code wasn't accepted. Check it and try again."),
                  });
                }}
                data-testid="two-factor-disable"
              >
                {disable.isPending ? "Turning off…" : "Turn off two-factor"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A code input that either accepts six digits or additionally a recovery code.
 *
 * The digit-only filter is genuinely helpful where a TOTP code is the only valid answer — it stops
 * a paste of "123 456" from failing — and actively harmful where a recovery code is allowed, since
 * it would silently eat every letter the user typed and leave them staring at a field that dropped
 * most of their input. Hence the flag rather than one lenient rule for both.
 */
function CodeField({
  id,
  label,
  value,
  onChange,
  allowRecoveryCode = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  allowRecoveryCode?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={allowRecoveryCode ? "text" : "numeric"}
        autoComplete="one-time-code"
        placeholder={allowRecoveryCode ? "123456 or ABCDE-FGHJK" : "123456"}
        maxLength={allowRecoveryCode ? 11 : 6}
        onChange={(e) =>
          onChange(allowRecoveryCode ? e.target.value : e.target.value.replace(/\D/g, ""))
        }
        data-testid={id}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { useTotpBootstrap, useTotpBootstrapVerify } from "@/lib/hooks/auth/use-totp-enrollment";
import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";
import { TotpQrCode } from "@/components/auth/totp-qr-code";
import { formatUserFacingError } from "@/lib/errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from "@/components/auth/auth-chrome";
import { cn } from "@/lib/utils";

/**
 * First-time two-factor enrolment, in the login card (GA-008).
 *
 * <h3>The deadlock this breaks</h3>
 *
 * Three roles hold permissions that trigger TOTP step-up (`rbac.manage`, `finance.period.close`,
 * `hr.payroll.approve`), and enrolment is part of account creation for accounts the seeder makes.
 * A tenant provisioned through the ordinary saga gets neither. Driving `gap-audit-bistro` end to
 * end during the audit: the forced password change worked, and the very next login returned
 * `401 TOTP_ENROLLMENT_REQUIRED` — against which the UI rendered
 *
 *   "Ask an administrator to complete enrolment before signing in."
 *
 * The account being refused is the OWNER. There is no administrator; they are the only account on
 * the tenant. A brand-new restaurant could not get into its own product, and the defect appeared
 * in no roadmap document, which is why it survived.
 *
 * `POST /api/v1/auth/2fa/bootstrap` and `/bootstrap/verify` were built for exactly this
 * (`TwoFactorController:35-50`) and are already public at the gateway. Grepping `frontend/` for
 * `2fa` returned two comments and no code path. This is the code path.
 *
 * <h3>Why it renders here rather than on its own route</h3>
 *
 * Both bootstrap calls re-authenticate by password. A separate page would have to receive that
 * password — through a URL, `sessionStorage`, or a store — and every one of those is a worse place
 * for a live credential than the React state it is already sitting in. The forced-password-change
 * flow can route away because it carries a single-use CHANGE TOKEN instead; there is no equivalent
 * token here. So enrolment happens in place: the password never leaves the form's memory, and
 * navigating away discards it, which is the correct outcome.
 *
 * <h3>QR, key and link — all three</h3>
 *
 * The QR is what a person actually uses, and it arrived late: this component shipped with manual
 * entry only because no `package.json` carried a QR library and adding one mid-triage was the wrong
 * trade. The other two paths stay because each covers a case the QR does not — the printed key for
 * a desktop authenticator or a password manager, and the `otpauth:` link for the user enrolling ON
 * the phone that holds the app, who has no second screen to point a camera at.
 *
 * <h3>Enrolment now ends on the recovery codes, not on success</h3>
 *
 * `/bootstrap/verify` returns the account's recovery codes and the server keeps only their digests,
 * so this component holds the single copy that will ever exist. It therefore does NOT call
 * `onEnrolled` when verification succeeds — it renders {@link RecoveryCodesPanel} and waits for the
 * user to acknowledge. Returning to the login form on success, as it did when the response was
 * empty, would now silently destroy them.
 */

interface TotpEnrollmentProps {
  email: string;
  password: string;
  /** From the `details` of the 401 that sent us here — the user is never asked for it. */
  tenantSlug: string;
  /** Enrolment complete; the caller returns to the credentials form so the user can sign in. */
  onEnrolled: () => void;
  onCancel: () => void;
}

/** The shared secret, pulled out of the provisioning URI for manual entry. */
function secretFrom(otpauthUri: string): string | null {
  try {
    return new URL(otpauthUri).searchParams.get("secret");
  } catch {
    // The server builds this URI, so a parse failure is a contract break, not user input. Fall
    // back to the raw link rather than blocking enrolment on a display nicety.
    return null;
  }
}

/** Grouped in fours — a 32-character base32 string is unreadable and mistypeable as one run. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function TotpEnrollment({
  email,
  password,
  tenantSlug,
  onEnrolled,
  onCancel,
}: TotpEnrollmentProps) {
  const bootstrap = useTotpBootstrap();
  const verify = useTotpBootstrapVerify();

  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const credentials = { email, password, tenantSlug };
  const secret = otpauthUri ? secretFrom(otpauthUri) : null;

  function startEnrolment() {
    setError(null);
    bootstrap.mutate(credentials, {
      onSuccess: (setup) => setOtpauthUri(setup.otpauthUri),
      onError: (e) => setError(formatUserFacingError(e)),
    });
  }

  function submitCode() {
    setError(null);
    verify.mutate(
      { ...credentials, code: code.trim() },
      {
        // Deliberately NOT onEnrolled() here. The response carries the recovery codes and nothing
        // can reissue them, so the flow stops on the panel that shows them.
        onSuccess: (result) => setRecoveryCodes(result.recoveryCodes),
        // The server returns the same refusal for a wrong code and an expired window, so the
        // message names the recoverable cause rather than guessing: a stale code is by far the
        // likelier of the two, and "wait for the next one" is the action either way.
        onError: () =>
          setError(
            "That code wasn't accepted. Codes change every 30 seconds — wait for the next one and try again.",
          ),
      },
    );
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the key and copy it manually.");
    }
  }

  if (recoveryCodes) {
    return (
      <div className="grid gap-4" data-testid="totp-enrollment">
        <div className="grid gap-1">
          <h2 className="text-h2 font-semibold text-foreground">Two-factor authentication is on</h2>
          <p className="text-body text-foreground-secondary">One last step before you sign in.</p>
        </div>
        <RecoveryCodesPanel
          codes={recoveryCodes}
          accountLabel={email}
          continueLabel="Done — take me to sign in"
          onAcknowledged={() => {
            toast.success("Two-factor authentication is set up. Sign in with your code.");
            onEnrolled();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="totp-enrollment">
      <div className="grid gap-1">
        <h2 className="text-h2 font-semibold text-foreground">Set up two-factor authentication</h2>
        <p className="text-body text-foreground-secondary">
          This account can approve payroll, close accounting periods or manage access, so signing in
          needs a code from an authenticator app as well as your password. Setting it up takes a
          minute and only happens once.
        </p>
      </div>

      {error ? (
        <Alert
          variant="destructive"
          className="items-start gap-x-3 border-destructive/35 bg-destructive/10 px-3.5 py-3"
        >
          <AlertTitle className="text-body">Setup failed</AlertTitle>
          <AlertDescription className="text-small">{error}</AlertDescription>
        </Alert>
      ) : null}

      {!otpauthUri ? (
        <>
          {/*
            A numbered rail rather than a `list-decimal` bullet run. The four steps are the whole
            of what this screen asks of a person who has never done it, and at 15px grey they read
            as a paragraph that happens to have numbers in it. The gold numerals are the demo's own
            device — an accent used to mark sequence, not to decorate.
          */}
          <ol className="grid gap-3">
            {[
              "Install an authenticator app — Google Authenticator, Authy, 1Password and Microsoft Authenticator all work.",
              "Press the button below to generate your setup code.",
              "Scan the QR code, then enter the six-digit code the app shows.",
              "Save the recovery codes we give you at the end.",
            ].map((instruction, index) => (
              <li key={instruction} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-label font-medium text-primary"
                >
                  {index + 1}
                </span>
                <span className="text-small text-foreground-secondary">{instruction}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-2">
            <Button
              type="button"
              onClick={startEnrolment}
              disabled={bootstrap.isPending}
              data-testid="totp-enroll-start"
              className={authPrimaryButtonClass}
            >
              {bootstrap.isPending ? "Generating…" : "Generate my key"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={bootstrap.isPending}
              className={authSecondaryButtonClass}
            >
              Back to sign in
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 rounded-lg border border-border bg-surface-1 p-4">
            <p className={authLabelClass}>Scan this with your authenticator app</p>
            <TotpQrCode otpauthUri={otpauthUri} />
            <p className="text-small text-foreground-tertiary">
              Can&apos;t scan it? Enter this key by hand instead:
            </p>
            {secret ? (
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 select-all rounded-md border border-border bg-background px-2.5 py-2 font-mono text-small tracking-[0.14em] break-all text-foreground"
                  data-testid="totp-secret"
                >
                  {grouped(secret)}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copySecret}
                  aria-label="Copy setup key"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            ) : null}
            {/* On a phone this opens the authenticator directly — every major app registers the
                otpauth: scheme — which is the closest thing to scanning a code without one. */}
            <a
              href={otpauthUri}
              className="text-small text-primary underline underline-offset-4"
              data-testid="totp-otpauth-link"
            >
              Open in your authenticator app
            </a>
            <p className="text-small text-foreground-tertiary">
              After you enter the code below we will give you recovery codes — those, not this key,
              are what gets you back in if you lose your phone.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="totp-enroll-code" className={authLabelClass}>
              Six-digit code from the app
            </Label>
            <Input
              id="totp-enroll-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              className={cn(authInputClass, "font-mono tracking-[0.3em]")}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim().length === 6) {
                  e.preventDefault();
                  submitCode();
                }
              }}
              data-testid="totp-enroll-code"
            />
          </div>

          <div className="grid gap-2">
            <Button
              type="button"
              onClick={submitCode}
              disabled={verify.isPending || code.trim().length !== 6}
              data-testid="totp-enroll-verify"
              className={authPrimaryButtonClass}
            >
              {verify.isPending ? "Verifying…" : "Finish setup"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={verify.isPending}
              className={authSecondaryButtonClass}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

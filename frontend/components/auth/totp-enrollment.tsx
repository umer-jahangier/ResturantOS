"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { useTotpBootstrap, useTotpBootstrapVerify } from "@/lib/hooks/auth/use-totp-enrollment";
import { formatUserFacingError } from "@/lib/errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
 * <h3>Manual entry, not a QR code — for now</h3>
 *
 * The product has no QR library in any `package.json` (GA-101), and adding a dependency to render
 * one is not something to do inside a triage phase. Manual entry is what every authenticator app
 * supports as its fallback, and on a phone the `otpauth://` link opens the app directly. Phase 23
 * adds the QR image; the flow it wraps is complete and correct without it.
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
        onSuccess: () => {
          toast.success("Two-factor authentication is set up. Sign in with your code.");
          onEnrolled();
        },
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

  return (
    <div className="grid gap-4" data-testid="totp-enrollment">
      <div>
        <h2 className="text-base font-medium">Set up two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">
          This account can approve payroll, close accounting periods or manage access, so signing in
          needs a code from an authenticator app as well as your password. Setting it up takes a
          minute and only happens once.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Setup failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!otpauthUri ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Install an authenticator app — Google Authenticator, Authy, 1Password and Microsoft
              Authenticator all work.
            </li>
            <li>Press the button below to generate your key.</li>
            <li>Add the key to the app, then enter the six-digit code it shows.</li>
          </ol>
          <Button
            type="button"
            onClick={startEnrolment}
            disabled={bootstrap.isPending}
            data-testid="totp-enroll-start"
          >
            {bootstrap.isPending ? "Generating…" : "Generate my key"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={bootstrap.isPending}>
            Back to sign in
          </Button>
        </>
      ) : (
        <>
          <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
            <p className="text-sm font-medium">Add this key to your authenticator app</p>
            {secret ? (
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 select-all break-all rounded bg-background px-2 py-1.5 font-mono text-sm tracking-wide"
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
              className="text-sm text-primary underline underline-offset-4"
              data-testid="totp-otpauth-link"
            >
              Open in your authenticator app
            </a>
            <p className="text-xs text-muted-foreground">
              Keep this key somewhere safe. If you lose the app and the key, only a platform
              administrator can reset it.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="totp-enroll-code">Six-digit code from the app</Label>
            <Input
              id="totp-enroll-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
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

          <Button
            type="button"
            onClick={submitCode}
            disabled={verify.isPending || code.trim().length !== 6}
            data-testid="totp-enroll-verify"
          >
            {verify.isPending ? "Verifying…" : "Finish setup"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={verify.isPending}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

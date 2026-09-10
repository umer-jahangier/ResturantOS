"use client";

import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildStepUpLoginHref } from "@/lib/auth/step-up";

interface StepUpRequiredNoticeProps {
  /** The blocked action, in the reader's words — "approve this payroll run", "close this period". */
  action: string;
}

/**
 * What a signed-in user sees when a step-up-gated action comes back `TOTP_REQUIRED`.
 *
 * <p>This is not a failure, and saying "Action failed" here would be a lie that costs the user
 * their afternoon: nothing is wrong with the account, the run, or the period. The `totp_verified`
 * claim simply is not carried across token refresh, so about an hour after signing in the proof
 * of possession behind payroll approval and period close expires while the session does not.
 *
 * <p>The only thing that restores it is another login with an authenticator code — there is no
 * step-up endpoint to call and no code this screen could usefully collect, which is why the
 * action here is "sign in again" rather than a code field. Coming back is handled: the current
 * path rides along as `?next=`, so the user lands where they left off.
 *
 * <h3>Why the amber is a token now and was a Tailwind palette literal before</h3>
 *
 * This panel shipped as `border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 …` —
 * six raw stops from Tailwind's stock palette, which follow neither `--brand-h` nor the theme.
 * Conformance gate G3 scored it as the single worst offender in `components/auth/`, and the
 * visible consequence was that the one panel a finance approver meets mid-task was the one panel
 * in the product wearing a different amber from everything around it.
 *
 * <p>The glyph chip is a SOLID `--warning` fill with `--warning-foreground` ink rather than the
 * soft tint the demo's `.kpi-icon` uses, and that is a measurement, not a preference:
 * `--warning` resolves to `--warning-400` in BOTH themes (unlike `--info`, `--success` and
 * `--destructive`, which flip to a 600 stop in light) precisely because amber at that lightness
 * is a fill and not a text colour. Drawn as a tinted glyph it would have measured about 2:1 on a
 * light card — under SC 1.4.11's 3:1 floor for a graphic that carries meaning. As a fill with
 * near-black ink it is the pairing the token system already declares.
 */
export function StepUpRequiredNotice({ action }: StepUpRequiredNoticeProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div role="alert" className="grid gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning text-warning-foreground"
        >
          <ShieldAlert className="size-4" />
        </span>
        <div className="grid gap-1">
          <p className="text-body font-semibold text-foreground">Verification expired</p>
          <p className="text-small text-foreground-secondary">
            To {action} you need to sign in again with your authenticator code. Your session is
            still valid — this extra check expires about an hour after you sign in.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => router.push(buildStepUpLoginHref(pathname))}
      >
        Sign in again
      </Button>
    </div>
  );
}

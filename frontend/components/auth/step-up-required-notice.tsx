"use client";

import { usePathname, useRouter } from "next/navigation";

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
 */
export function StepUpRequiredNotice({ action }: StepUpRequiredNoticeProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="font-medium">Verification expired</p>
      <p>
        To {action} you need to sign in again with your authenticator code. Your session is still
        valid — this extra check expires about an hour after you sign in.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => router.push(buildStepUpLoginHref(pathname))}
      >
        Sign in again
      </Button>
    </div>
  );
}

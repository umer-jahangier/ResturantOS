"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OneTimePassword } from "@/lib/models/user.model";

/**
 * The ONE place in this product that renders a temporary password.
 *
 * <h3>Why one component and not two</h3>
 *
 * Creating a user and resetting a user's password both mint a credential that crosses the wire
 * exactly once — auth-service stores only its hash, 13-12 overrode `CreatedUser.toString()` to
 * `<redacted>`, and nothing in either service logs it. Two components would mean two copies of the
 * "this will not be shown again" wording, and the copy that drifts is the one an admin closes
 * without reading.
 *
 * <h3>What it deliberately does not do</h3>
 *
 * <ul>
 *   <li><b>It is never auto-dismissed.</b> No toast, no timeout. A toast that expires while the
 *       admin is opening WhatsApp destroys the only copy of a credential that cannot be re-read.</li>
 *   <li><b>It does not mask the value behind a reveal toggle.</b> The admin is authorised to see it
 *       — that is the whole transaction — and a hidden field they have to click is one more way to
 *       close the dialog without ever having read it.</li>
 *   <li><b>It is not written to the query cache</b> by any caller. It lives in component state for
 *       the life of the dialog and nowhere else.</li>
 * </ul>
 *
 * <h3>Clipboard</h3>
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be refused by permission policy.
 * Failure is reported in the button rather than swallowed, because an admin who believes they
 * copied a one-time password and did not has lost it — the value stays selectable so a manual copy
 * is always possible.
 */
export function OneTimePasswordPanel({
  result,
  intro,
}: {
  result: OneTimePassword;
  /** One sentence naming what just happened — "Account created", "Password reset". */
  intro: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.tempPassword);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div
      // `alert` rather than `status`: an assistive-technology user must not be able to move past
      // this without it having been announced, for exactly the same reason it is not a toast.
      role="alert"
      data-testid="one-time-password"
      className="space-y-3 rounded-lg border border-primary-700/40 bg-primary-700/5 p-4"
    >
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-small font-medium text-foreground">{intro}</p>
          <p className="text-small text-muted-foreground">
            Give this temporary password to{" "}
            <span className="font-medium text-foreground">{result.email}</span> in person or over a
            channel you trust. They will be required to change it the first time they sign in.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <code
          data-testid="one-time-password-value"
          className="relative flex-1 overflow-x-auto rounded-md border border-border-interactive bg-background px-3 py-2 font-mono text-small select-all"
        >
          {result.tempPassword}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copyState === "copied" ? (
            <>
              <Check className="size-3.5" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" /> Copy
            </>
          )}
        </Button>
      </div>

      {copyState === "failed" && (
        <p className="text-label text-destructive">
          This browser refused clipboard access. Select the password above and copy it manually
          before closing.
        </p>
      )}

      <p className="text-small font-medium text-destructive">
        This password will not be shown again. There is no way to retrieve it — only to issue a new
        one.
      </p>

      {result.loginable === false && (
        <p className="text-small text-warning-foreground">
          This account has no role on any branch yet, so it cannot sign in even with this password.
          Assign a role to finish setting it up.
        </p>
      )}
    </div>
  );
}

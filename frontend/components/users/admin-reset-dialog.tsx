"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OneTimePasswordPanel } from "@/components/users/one-time-password-panel";
import { useAdminResetPassword } from "@/lib/hooks/use-users";
import { formatUserFacingError } from "@/lib/errors";
import type { OneTimePassword, TenantUser } from "@/lib/models/user.model";

/**
 * Administrator-initiated password reset (plan 13-13).
 *
 * <h3>Why this is the only reset in the product</h3>
 *
 * Self-service "forgot password" ships DISABLED, and not by oversight: 13-09 (D-31) records that no
 * notification consumer exists, so no email can be sent, and shipping a form that silently sends
 * nothing would be worse than not shipping it. That makes this dialog the platform's only working
 * way to set another user's password, which is why the temporary password comes back in the
 * response to be handed over out of band rather than mailed.
 *
 * <h3>Why `reason` is a required field and not a nicety</h3>
 *
 * The API refuses a blank reason with a 400 at both tiers, and the value lands in the
 * `ADMIN_PASSWORD_RESET` audit event. An administrator taking over another person's account leaves
 * a record that says why. Marking it optional here would just move the refusal to after the click.
 *
 * <h3>What a reset actually does</h3>
 *
 * New temporary password · `must_change_password = true` · failed-login counter zeroed ·
 * lockout cleared · previous hash appended to history · every outstanding reset token retired ·
 * every refresh session revoked · one audit event. The dialog says the parts a user can act on —
 * in particular that a locked-out account is unlocked, because that is the difference between a
 * reset and a no-op and it is the reason an admin reaches for this.
 */
export function AdminResetDialog({
  user,
  open,
  onOpenChange,
}: {
  user: TenantUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reset = useAdminResetPassword();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<OneTimePassword | null>(null);

  function close() {
    onOpenChange(false);
    setReason("");
    setResult(null);
    reset.reset();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || reason.trim() === "") return;
    reset.mutate(
      { userId: user.id, reason: reason.trim() },
      {
        onSuccess: (issued) => setResult(issued),
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {result ? "Password reset" : `Reset password for ${user.email}`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Hand this over in person or over a channel you trust."
              : "This signs the user out everywhere, clears any lockout, and issues a temporary password you hand over yourself. No email is sent — the platform has no mail delivery yet."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <OneTimePasswordPanel
              result={result}
              intro="The old password no longer works and every session has been signed out."
            />
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-reason">Reason</Label>
              <Input
                id="reset-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. locked out after forgetting their password"
                required
                aria-describedby="reset-reason-hint"
              />
              <p id="reset-reason-hint" className="text-label text-muted-foreground">
                Recorded in the audit trail against your name. Required.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={reset.isPending || reason.trim() === ""}>
                {reset.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

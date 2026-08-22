"use client";

import { useClosePeriod } from "@/lib/hooks/finance/use-periods";
import { StepUpRequiredNotice } from "@/components/auth/step-up-required-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUserFacingError } from "@/lib/errors";
import type { AccountingPeriod } from "@/lib/models/finance.model";

interface PeriodCloseModalProps {
  period: AccountingPeriod;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Confirm the one irreversible action in this module.
 *
 * <h3>What changed in 38-08, and what deliberately did not</h3>
 *
 * The dialog was hand-rolled: a `fixed inset-0 bg-black/50` backdrop with `role="dialog"` written
 * on it by hand, no focus trap, no Escape handling, no scroll lock — and fourteen raw palette
 * literals carrying its warning and success surfaces. It is now the shared {@link Dialog}, which
 * brings the focus management with it, and the two surfaces are token tints that follow the
 * theme.
 *
 * <p>What did not change is the ASK. The step-up gate is satisfied by the access token's
 * `totp_verified` claim, not by anything this dialog can send, so it asks for confirmation and
 * not for a code. When the claim has aged out the server says so and the notice routes the user
 * to re-authenticate.
 */
function PeriodCloseModal({ period, onClose, onSuccess }: PeriodCloseModalProps) {
  const { mutate: closePeriod, isPending, error, isSuccess } = useClosePeriod();

  const stepUpRequired = error?.isTotpRequired() ?? false;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closePeriod(period.id, {
      onSuccess: () => {
        onSuccess();
      },
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Accounting Period</DialogTitle>
          <DialogDescription>
            {period.startDate} – {period.endDate}
          </DialogDescription>
        </DialogHeader>

        {/* The word "permanently" is the whole warning, so it is in the text and not only in the
            amber. Foreground stays `text-foreground` — measured in 38-01,
            `text-warning-foreground` on a `bg-warning/10` surface does not hold contrast. */}
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-small text-foreground">
          <strong>Warning:</strong> Closing a period locks it permanently. No new journal entries
          can be posted to a locked period.
        </p>

        {isSuccess ? (
          <p
            role="status"
            className="rounded-lg border border-success/40 bg-success/10 p-3 text-small text-foreground"
          >
            Period closed successfully.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {stepUpRequired && <StepUpRequiredNotice action="close this period" />}

            {error && !stepUpRequired && (
              <p className="text-small text-destructive" role="alert">
                {formatUserFacingError(error)}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isPending || stepUpRequired}>
                {isPending ? "Closing…" : "Close Period"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { PeriodCloseModal };

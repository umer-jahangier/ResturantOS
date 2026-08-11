"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The one destructive-confirmation primitive (UI-SPEC §8.2, §8.3; brief §50, §51, §62).
 *
 * <h3>What the audit found</h3>
 *
 * ```
 * grep -rl 'AlertDialog\|ConfirmDialog' app components  →  0
 * ```
 *
 * Zero primitives — and confirmation nonetheless implemented **six times**, each a bespoke
 * `Dialog` plus a local handler: `app/(tenant)/app/stations/page.tsx:192`,
 * `purchasing/vendors/[id]/page.tsx:413`, `inventory/setup/page.tsx:345`,
 * `inventory/ingredients/page.tsx:335`, `inventory/categories/page.tsx:257`, and
 * `components/pos/void-refund-dialog.tsx:143`.
 *
 * Brief §50 was therefore *behaviourally* satisfied and *structurally* violated. §62 requires
 * that if one delete confirms, all equivalent deletes confirm — six independent copies is
 * precisely how that stops being true, one refactor at a time.
 *
 * <h3>The confirm button restates the verb</h3>
 *
 * `OK` is not an answer to "archive this ingredient?" — it is an answer to a question the user
 * has already stopped reading. The label is required and validated against a denylist in tests,
 * because the failure mode is a tired author typing `OK` and nobody noticing until someone voids
 * the wrong payment.
 *
 * <h3>What must NOT come through here</h3>
 *
 * UI-SPEC §8.2: confirm only what is destructive or irreversible. **Never** save, availability
 * toggle, filter, sort or navigate. Where an action is safely reversible, prefer a toast with an
 * action — `Product archived. [Undo]` — because a dialog on a reversible action trains people to
 * dismiss dialogs, which is how the irreversible one gets dismissed too.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Names the object and the question: "Void payment of Rs 5,046.00 for ORD-20260811-0017?" */
  title: string;
  /** Names the CONSEQUENCE: "This posts a reversing entry to the ledger." */
  body: React.ReactNode;

  /**
   * Restates the verb — `Void payment`, `Archive ingredient`, `Retire station`.
   * Never `OK`, `Yes` or `Confirm`.
   */
  confirmLabel: string;
  /** Shown on the confirm button while the mutation is in flight. `Archiving…` */
  pendingLabel?: string;
  cancelLabel?: string;

  /**
   * `destructive` paints the confirm button with `--destructive`. `neutral` is for irreversible
   * but non-destructive steps — closing a period, submitting for approval — where red would
   * overstate the danger and make the genuinely destructive red mean less.
   */
  tone?: "destructive" | "neutral";

  onConfirm: () => void;
  isPending?: boolean;

  /**
   * A refusal from the server, shown ABOVE the buttons.
   *
   * <p>Not every destructive action is permitted: archiving a category that ingredients still
   * reference is refused with a reason, and that reason has to land somewhere the operator is
   * already looking. Without this slot the categories screen could not migrate here without
   * losing its refusal message, and "the primitive does not support my case" is how the seventh
   * bespoke dialog gets written.
   */
  error?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  onConfirm,
  isPending = false,
  error,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div role="alert" className="rounded-lg border bg-card px-2.5 py-2 text-small text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
            data-testid="confirm-dialog-confirm"
          >
            {isPending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Labels that answer no question. Exported so the gate and the component share one list —
 * a denylist duplicated in a test is a denylist that drifts from the one people read.
 */
export const NON_ANSWER_LABELS = ["ok", "okay", "yes", "confirm", "continue", "submit"];

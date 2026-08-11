"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Confirmation for an action that changes what a real tenant's staff can do.
 *
 * <h3>Typing the name is not friction for its own sake</h3>
 *
 * House rule: destructive actions must name what they affect. Suspending a tenant takes a
 * restaurant offline mid-service; disabling a module makes its screens vanish for every user of
 * that tenant on their next request. Both are one click from a list of visually similar rows, and
 * a plain "Are you sure?" is answered reflexively — it confirms the *intent to click*, not the
 * *identity of the target*. Requiring the tenant's name typed back confirms the operator knows
 * WHICH row they are on, which is the mistake actually worth preventing here.
 *
 * The comparison is trimmed but case-sensitive: a brand name is proper-noun data, and accepting a
 * lowercase match would quietly weaken the one check standing between a mis-click and an outage.
 *
 * <h3>The consequence is stated before the input, not after</h3>
 *
 * `consequence` renders above the confirmation field so the operator reads what will happen before
 * they start typing, rather than discovering it beside a button they have already committed to.
 */
interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What this will do, in plain words, naming the affected tenant. */
  consequence: React.ReactNode;
  /** The exact string the operator must type — the tenant's brand name. */
  confirmPhrase: string;
  confirmLabel: string;
  /** Optional free-text reason, sent to the API and written to the audit trail. */
  reasonLabel?: string;
  isPending?: boolean;
  error?: React.ReactNode;
  onConfirm: (reason: string) => void;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  ...rest
}: ConfirmDestructiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The body is mounted only while the dialog is open, so the typed confirmation resets by
        UNMOUNTING rather than by an effect that clears it. That distinction is not stylistic: a
        reset-on-open effect runs a render AFTER the dialog is already visible, so there is one
        frame in which the previous attempt's text is on screen and satisfying the gate. For a
        control whose entire job is to prove the operator re-read the target name, a frame of
        pre-filled confirmation is the one state it must never have.
      */}
      {open && <ConfirmDestructiveBody onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  );
}

function ConfirmDestructiveBody({
  onOpenChange,
  title,
  consequence,
  confirmPhrase,
  confirmLabel,
  reasonLabel,
  isPending,
  error,
  onConfirm,
}: Omit<ConfirmDestructiveDialogProps, "open">) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");

  const nameMatches = typed.trim() === confirmPhrase.trim();
  const reasonRequired = Boolean(reasonLabel);
  const canConfirm = nameMatches && (!reasonRequired || reason.trim().length > 0) && !isPending;

  return (
    <>
      <DialogContent data-testid="confirm-destructive">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">{consequence}</div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-phrase">
              Type <span className="font-mono font-semibold">{confirmPhrase}</span> to confirm
            </Label>
            <Input
              id="confirm-phrase"
              value={typed}
              autoComplete="off"
              data-testid="confirm-phrase-input"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>

          {reasonLabel && (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reason">{reasonLabel}</Label>
              <Input
                id="confirm-reason"
                value={reason}
                data-testid="confirm-reason-input"
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recorded against this tenant. Write what a colleague would need to understand the
                decision in six months.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/15 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            data-testid="confirm-destructive-submit"
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}

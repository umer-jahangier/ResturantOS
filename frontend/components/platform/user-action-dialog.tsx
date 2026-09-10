"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

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

/**
 * Confirmation for a platform-tier action on one person, carrying the reason the API demands.
 *
 * <h3>Why the reason field is the request body, not a UI nicety</h3>
 *
 * All five actions — deactivate, reactivate, unlock, revoke sessions, reset password — take
 * `{"reason": "…"}` and refuse a blank one, because every one of them writes a row to
 * `platform_admin_audit` and a row that cannot say why is one somebody has to interpret rather
 * than read. So the field IS the body and the submit button waits for it. There is deliberately no
 * acting-administrator field anywhere in this dialog: a body field naming the actor is a field a
 * caller can fill in with somebody else's name, and the acting id comes from the `sub` of the
 * verified control-plane token instead.
 *
 * <h3>Why neither existing confirmation primitive could host it</h3>
 *
 * `ConfirmDialog` — the product's one confirmation primitive — renders its `body` inside
 * `DialogDescription`, which is a `<p>`. A `<label>` and an `<input>` inside a paragraph is
 * invalid nesting, and the primitive's confirm button is gated on `isPending` alone with no way to
 * wait for a field it does not know about. It is the right component for "archive this
 * ingredient?" and it cannot be the right one for a call that will not accept an empty reason.
 *
 * <p>`ConfirmDestructiveDialog` solves the reason correctly, and requires the target's name typed
 * back — a good rule for suspending a restaurant. Two of these five actions RESTORE access
 * (reactivate, unlock), and demanding the same ceremony to give somebody their account back as to
 * take it away trains an operator to type through the ceremony, which is how the destructive one
 * gets typed through too. So the typed confirmation is available here and is opt-in per action.
 *
 * <h3>The consequence is stated before the input</h3>
 *
 * Same convention every caller in this console follows: say what STOPS, say who it happens TO by
 * name, and say plainly what is NOT deleted — because on this control plane almost nothing is, and
 * an operator who believes otherwise will avoid a correct action or panic after a right one.
 */
export interface UserActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What this will do, in plain words, naming the person it happens to. */
  consequence: React.ReactNode;
  /** Restates the verb — `Deactivate account`, `Clear lockout`. Never `OK`, `Yes` or `Confirm`. */
  confirmLabel: string;
  /** The label above the mandatory reason. Every action names its own. */
  reasonLabel: string;
  /**
   * Present ⇒ the operator must type this string back before the button enables. Reserved for the
   * actions that remove access or mint a credential; the two that restore access omit it.
   */
  confirmPhrase?: string;
  /** `destructive` for the three that take access away or issue a password; `neutral` restores. */
  tone?: "destructive" | "neutral";
  isPending?: boolean;
  error?: React.ReactNode;
  onConfirm: (reason: string) => void;
  "data-testid"?: string;
}

export function UserActionDialog({ open, onOpenChange, ...rest }: UserActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The body is mounted only while the dialog is open, so the typed confirmation and the reason
        reset by UNMOUNTING rather than through an effect. That is not stylistic: a reset-on-open
        effect runs a render AFTER the dialog is visible, so there is one frame in which the
        previous attempt's text is on screen and satisfying the gate.
      */}
      {open && <UserActionBody onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  );
}

function UserActionBody({
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  reasonLabel,
  confirmPhrase,
  tone = "destructive",
  isPending,
  error,
  onConfirm,
  "data-testid": testId,
}: Omit<UserActionDialogProps, "open">) {
  const [reason, setReason] = React.useState("");
  const [typed, setTyped] = React.useState("");

  // Trimmed but case-sensitive, as `ConfirmDestructiveDialog` does it: an email is data, and
  // accepting a different case would weaken the one check standing between a mis-click and the
  // wrong person losing their account.
  const phraseMatches = confirmPhrase === undefined || typed.trim() === confirmPhrase.trim();
  const canConfirm = reason.trim().length > 0 && phraseMatches && !isPending;

  return (
    <DialogContent data-testid={testId ?? "user-action-dialog"}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {tone === "destructive" && (
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          )}
          {title}
        </DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2 text-small">{consequence}</div>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-(--space-md)">
        {confirmPhrase !== undefined && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-action-phrase">
              Type <span className="font-mono font-semibold break-all">{confirmPhrase}</span> to
              confirm
            </Label>
            <Input
              id="user-action-phrase"
              value={typed}
              autoComplete="off"
              data-testid="user-action-phrase-input"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-action-reason">{reasonLabel}</Label>
          <Input
            id="user-action-reason"
            value={reason}
            maxLength={500}
            data-testid="user-action-reason-input"
            onChange={(event) => setReason(event.target.value)}
          />
          {/*
            Unlike the tenant dialogs, this one CAN name the destination: all five user actions
            write to `platform_admin_audit`, which is append-only at the trigger layer and is read
            back by the trail at the bottom of this page. Saying so is the difference between a
            field an operator fills in properly and one they type a full stop into.
          */}
          <p className="text-label text-muted-foreground">
            Required. Recorded against your account in the operator trail below, where it cannot be
            edited or removed. Write what a colleague would need to understand this in six months.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/15 p-3 text-small text-destructive"
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
          variant={tone === "destructive" ? "destructive" : "default"}
          disabled={!canConfirm}
          data-testid="user-action-submit"
          onClick={() => onConfirm(reason.trim())}
        >
          {isPending ? "Working…" : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

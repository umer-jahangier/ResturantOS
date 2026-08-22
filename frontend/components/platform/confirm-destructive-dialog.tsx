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
 * The copy convention every caller follows: say what STOPS, say who it happens TO by name, and say
 * plainly what is NOT deleted — because on this control plane almost nothing is, and an operator
 * who believes otherwise will avoid a correct action or panic after a right one.
 *
 * <h3>Why the reason field is the request body, not a UI nicety</h3>
 *
 * Suspend, cancel and every platform-tier action on a user take `{"reason": "…"}` and refuse a blank
 * one, because a record that cannot say why is one somebody has to interpret rather than read. So
 * the field is not decoration that could be dropped later: it IS the body, and the submit button
 * waits for it for exactly that reason.
 *
 * <p>Where an endpoint takes no body — `reactivate`, `close`, `tier` — `reasonLabel` is omitted
 * rather than collected and discarded, because a field whose value goes nowhere teaches an operator
 * that none of them matter. Those callers say so in their consequence block instead, since an
 * operator is entitled to know when the trail will hold no explanation.
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
  /** Present ⇒ the API demands a reason and the button waits for one. */
  reasonLabel?: string;
  /**
   * One extra control the action genuinely needs — retry-provisioning's administrator address is
   * the only caller today. Its VALUE lives with the caller, which is why {@link confirmDisabled}
   * exists: this dialog can gate on the name and the reason, and only the caller can say whether
   * its own field is filled in.
   */
  extraFields?: React.ReactNode;
  /** Caller-side validity for {@link extraFields}. */
  confirmDisabled?: boolean;
  isPending?: boolean;
  error?: React.ReactNode;
  onConfirm: (reason: string) => void;
  "data-testid"?: string;
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
  extraFields,
  confirmDisabled = false,
  isPending,
  error,
  onConfirm,
  "data-testid": testId,
}: Omit<ConfirmDestructiveDialogProps, "open">) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");

  const nameMatches = typed.trim() === confirmPhrase.trim();
  const reasonRequired = Boolean(reasonLabel);
  const canConfirm =
    nameMatches && (!reasonRequired || reason.trim().length > 0) && !confirmDisabled && !isPending;

  return (
    <DialogContent data-testid={testId ?? "confirm-destructive"}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          {title}
        </DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2 text-small">{consequence}</div>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-(--space-md)">
        {extraFields}

        <div className="flex flex-col gap-1.5">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-reason">{reasonLabel}</Label>
            <Input
              id="confirm-reason"
              value={reason}
              data-testid="confirm-reason-input"
              onChange={(e) => setReason(e.target.value)}
            />
            {/*
              No claim is made here about WHERE the reason lands, because it differs per endpoint
              and getting that wrong on this screen is the kind of confident falsehood the whole
              console is built to avoid: a tier move records it in `subscription_history` with the
              acting account attached, a user action records it in the operator trail, and a tenant
              suspension or cancellation carries it only into a service log line. Each caller states
              its own destination in the consequence block above.
            */}
            <p className="text-label text-muted-foreground">
              Sent with the request. Write what a colleague would need to understand the decision in
              six months.
            </p>
          </div>
        )}

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
          variant="destructive"
          disabled={!canConfirm}
          data-testid="confirm-destructive-submit"
          onClick={() => onConfirm(reason.trim())}
        >
          {isPending ? "Working…" : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

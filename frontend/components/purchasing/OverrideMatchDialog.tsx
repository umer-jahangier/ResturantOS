"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useOverrideMatch } from "@/lib/hooks/purchasing/use-purchasing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MIN_JUSTIFICATION_LENGTH = 10;

/**
 * Overrides a MISMATCHED invoice's failed 3-way match with a mandatory justification (>= 10
 * chars, mirrors `overrideMatchInputSchema`). No permission-gating helper exists in this codebase
 * yet (only `useNavVisibility` for nav items, nothing for inline action buttons) — this button
 * always renders; if the current user lacks `vendor.invoice.override`, the mutation's 403
 * surfaces as a toast rather than being hidden proactively. Noted in the 10-13 SUMMARY.
 */
export function OverrideMatchDialog({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const overrideMatch = useOverrideMatch(invoiceId);

  const tooShort = justification.trim().length < MIN_JUSTIFICATION_LENGTH;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setJustification("");
  }

  function handleSubmit() {
    overrideMatch.mutate(justification.trim(), {
      onSuccess: () => {
        toast.success("Match overridden — invoice approved for payment");
        setOpen(false);
      },
      onError: (error) => {
        toast.error(error.message || "Could not override the match. Please try again.");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Override match
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override 3-way match</DialogTitle>
          <DialogDescription>
            This invoice failed the 3-way match. Overriding requires a justification (at least{" "}
            {MIN_JUSTIFICATION_LENGTH} characters) and moves the invoice to Approved for payment.
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Override justification"
          placeholder="Explain why this mismatch is acceptable to pay…"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={overrideMatch.isPending || tooShort}
            onClick={handleSubmit}
          >
            {overrideMatch.isPending ? "Overriding…" : "Override & approve for payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { modifierGroupRule, type ModifierGroup } from "@/lib/models/modifier.model";
import type { MenuItem } from "@/lib/models/pos.model";
import type { CartModifier } from "@/components/pos/cart-reducer";
import { cn } from "@/lib/utils";

interface ModifierDialogProps {
  /** The dish being configured; null closes the dialog. */
  item: MenuItem | null;
  /**
   * The dish's groups, in catalogue order — or `undefined` when the catalogue read has not
   * answered. `undefined` is NOT "no options": with `isError` set it means the till could not find
   * out, and a forced group would then be skipped in silence. The two are rendered differently.
   */
  groups: ModifierGroup[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isRetrying: boolean;
  onRetry: () => void;
  onCancel: () => void;
  /** Adds the configured line to the cart. Only ever called with a valid selection. */
  onConfirm: (modifiers: CartModifier[]) => void;
}

/**
 * Configure a dish before it reaches the cart (S6) — "medium spicy, extra cheese, no raita".
 *
 * <h2>What this replaces</h2>
 *
 * <p>Nothing. Tapping a dish added the line instantly, measured in the walkthrough as
 * {@code {dialogs: 0, noteControls: []}} — no spice level, no half/full, no size, no course, and
 * the order drawer's only note control applied to the WHOLE check. A cashier could not ring "no
 * onions" and the restaurant could not sell a paid add-on.
 *
 * <h2>Validation is at the UI as the cashier taps, and the field is named</h2>
 *
 * <p>The Add button is disabled until every forced group is answered, and the reason is printed
 * against the group it belongs to — "Spice level: choose exactly 1 option" — rather than as one
 * summary at the bottom. That is DESIGN-BRIEF §26: the error names the field and the real problem.
 *
 * <p>None of it is load-bearing for correctness. The SERVER enforces the same rules in
 * {@code ModifierSelectionResolver}, with the same wording, because this dialog is not the only
 * caller of {@code POST /orders/{id}/items}. A rule enforced only in a dialog is a rule that is
 * true only while the dialog is open.
 */
export function ModifierDialog({
  item,
  groups,
  isLoading,
  isError,
  error,
  isRetrying,
  onRetry,
  onCancel,
  onConfirm,
}: ModifierDialogProps) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [configuredItemId, setConfiguredItemId] = useState<string | null>(item?.id ?? null);

  // A new dish is a new configuration — and so is REOPENING the same dish after a cancel: a
  // half-made choice surviving a dismissal is how a cashier rings the previous guest's spice
  // level. (`item` is set to null on close, so the id genuinely changes both ways.)
  //
  // Adjusted during render rather than in an effect. React's own guidance, and not a style
  // preference: an effect would render the NEW dish once with the PREVIOUS dish's selection still
  // highlighted before correcting itself, which on a touch screen is a visible wrong answer.
  if ((item?.id ?? null) !== configuredItemId) {
    setConfiguredItemId(item?.id ?? null);
    setSelected({});
    setSubmitAttempted(false);
  }

  const activeGroups = useMemo(() => (groups ?? []).filter((g) => g.active), [groups]);

  /** Per-group refusal text, or null when the group is satisfied. The server's own wording. */
  const groupErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const group of activeGroups) {
      const chosen = selected[group.id]?.length ?? 0;
      if (chosen < group.minSelect || chosen > group.maxSelect) {
        errors[group.id] =
          `${group.name}: choose ${modifierGroupRule(group)}` +
          (chosen === 0 ? "." : ` — you have chosen ${chosen}.`);
      }
    }
    return errors;
  }, [activeGroups, selected]);

  const chosenModifiers = useMemo<CartModifier[]>(() => {
    const out: CartModifier[] = [];
    // Catalogue order, not tap order — the order the ticket and the bill will print them in.
    for (const group of activeGroups) {
      for (const option of group.options) {
        if (selected[group.id]?.includes(option.id)) {
          out.push({ id: option.id, name: option.name, priceDeltaPaisa: option.priceDeltaPaisa });
        }
      }
    }
    return out;
  }, [activeGroups, selected]);

  const deltaTotalPaisa = chosenModifiers.reduce((sum, m) => sum + m.priceDeltaPaisa, 0);
  const unitTotalPaisa = (item?.basePricePaisa ?? 0) + deltaTotalPaisa;
  const blockingErrors = Object.values(groupErrors);
  const canAdd = !isLoading && !isError && blockingErrors.length === 0;

  function toggle(group: ModifierGroup, optionId: string) {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      const isOn = current.includes(optionId);
      if (isOn) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      // A "choose exactly one" group behaves like a radio: tapping a second option REPLACES the
      // first rather than refusing the tap. Refusing would leave the cashier hunting for which of
      // two identical-looking buttons to untick.
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: [optionId] };
      }
      if (current.length >= group.maxSelect) {
        // At the ceiling: keep the tap honest by showing the rule rather than silently ignoring it.
        setSubmitAttempted(true);
        return { ...prev, [group.id]: [...current, optionId] };
      }
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-lg" data-testid="modifier-dialog">
        <DialogHeader>
          <DialogTitle>{item?.name ?? "Configure item"}</DialogTitle>
          <DialogDescription>
            Choose how this is made. Nothing is saved until you press Add to order.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {isError ? (
            <QueryErrorNotice
              what="this dish's options"
              moduleLabel="POS"
              error={error}
              stillWorks="Dishes without options can still be rung, and tickets already sent are unaffected."
              isRetrying={isRetrying}
              onRetry={onRetry}
            />
          ) : isLoading ? (
            <div className="space-y-3" aria-busy="true" data-testid="modifier-dialog-skeleton">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : activeGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This dish has no options to choose. Press Add to order.
            </p>
          ) : (
            activeGroups.map((group) => {
              const chosen = selected[group.id] ?? [];
              const showError = submitAttempted && groupErrors[group.id];
              return (
                <fieldset
                  key={group.id}
                  className="space-y-2"
                  data-testid={`modifier-group-${group.id}`}
                >
                  <legend className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{group.name}</span>
                    <span
                      className={cn(
                        "text-xs",
                        group.required ? "font-medium text-primary" : "text-muted-foreground",
                      )}
                    >
                      {group.required ? "Required — " : "Optional — "}
                      choose {modifierGroupRule(group)}
                    </span>
                  </legend>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {group.options.map((option) => {
                      const on = chosen.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          data-testid={`modifier-option-${option.id}`}
                          onClick={() => toggle(group, option.id)}
                          className={cn(
                            // `items-start` + a wrapping name, NOT `truncate`. A till button
                            // reading "Extra ch…" beside another reading "Extra ra…" is two
                            // buttons a cashier cannot tell apart at a glance, which is a
                            // mis-punch on the guest's bill. Two lines is cheaper than that.
                            "flex min-h-11 items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors active:scale-[0.98]",
                            on
                              ? "border-primary bg-primary/10 ring-1 ring-primary"
                              : "bg-card hover:border-primary hover:bg-accent",
                          )}
                        >
                          <span className="flex min-w-0 flex-1 items-start gap-2">
                            {on && (
                              <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="text-sm break-words">{option.name}</span>
                          </span>
                          {option.priceDeltaPaisa !== 0 && (
                            <span className="mt-0.5 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                              {option.priceDeltaPaisa > 0 ? "+" : "−"}
                              <MoneyDisplay
                                paisa={Math.abs(option.priceDeltaPaisa)}
                                className="text-xs"
                              />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/*
                    Shown the MOMENT the group is unsatisfied, not after a failed submit.
                    The first cut gated this on `submitAttempted` and paired it with an
                    `aria-disabled` Add button — so the only way to learn why the button was
                    dead was to press a button that assistive tech and Playwright both
                    correctly refuse to activate. A disabled control whose reason is behind
                    the control is a control with no reason at all.

                    `role="status"` until a submit is attempted and `role="alert"` after:
                    before the cashier has tried, this is guidance and must not interrupt a
                    screen reader; once they have tried, it is the answer to what just
                    happened and must.
                  */}
                  {groupErrors[group.id] && (
                    <p
                      role={showError ? "alert" : "status"}
                      data-testid={`modifier-group-error-${group.id}`}
                      className={cn(
                        "flex items-center gap-1.5 text-xs",
                        showError ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      {groupErrors[group.id]}
                    </p>
                  )}
                </fieldset>
              );
            })
          )}
        </div>

        {/* What this plate costs with the choices on it — before it reaches the cart, not after. */}
        {!isError && !isLoading && (
          <div
            className="flex items-baseline justify-between border-t pt-3 text-sm"
            data-testid="modifier-dialog-total"
          >
            <span className="text-muted-foreground">
              This item{deltaTotalPaisa !== 0 ? " with options" : ""}
            </span>
            <MoneyDisplay paisa={unitTotalPaisa} className="font-mono text-base" />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="modifier-dialog-add"
            // Disabled AND explained. The explanation is beside the group it belongs to and is on
            // screen BEFORE this button is pressed (see the per-group note above) — `aria-disabled`
            // is honoured by assistive tech and by Playwright, so a reason that only appears after
            // a click is a reason nobody can reach.
            aria-disabled={!canAdd}
            aria-describedby={blockingErrors.length > 0 ? "modifier-dialog-blocked" : undefined}
            onClick={() => {
              setSubmitAttempted(true);
              if (!canAdd) return;
              onConfirm(chosenModifiers);
            }}
            className={cn(!canAdd && "cursor-not-allowed opacity-60")}
          >
            Add to order
          </Button>
        </DialogFooter>

        {blockingErrors.length > 0 && (
          <p
            id="modifier-dialog-blocked"
            role={submitAttempted ? "alert" : "status"}
            data-testid="modifier-dialog-blocked"
            className={cn(
              "text-xs",
              submitAttempted ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {blockingErrors[0]}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

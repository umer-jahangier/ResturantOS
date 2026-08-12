"use client";

import { useMemo, useState } from "react";
import { Percent, Tag } from "lucide-react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useApplyDiscount } from "@/lib/hooks/pos/use-orders";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatPaisa, parseRupeesToPaisa } from "@/lib/adapters/shared";
import type { Order, OrderItem } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface DiscountPanelProps {
  order: Order;
}

type Scope = "LINE" | "ORDER";
type DiscountType = "PERCENT" | "FLAT";

/**
 * The permission a cashier does NOT hold. Named once, here, so the copy below and the enable
 * state can never drift apart — and so nothing renders the raw code at the operator.
 */
const WHOLE_CHECK_PERMISSION = "pos.order.discount.override";
const LINE_PERMISSION = "pos.order.discount.line";

/**
 * Take money off a check — the control that did not exist (B3).
 *
 * <h3>What was here before</h3>
 *
 * Nothing. The walkthrough probed the charge page, the POS terminal and the order drawer for any
 * control matching /discount|comp|off|promo/ and got `[]` from all three, while the endpoint
 * behind them refused every fired check with `409 Cannot apply discount to order in status:
 * SENT_TO_KDS` — for the cashier AND the manager, at both scopes. `useApplyDiscount()` existed
 * with zero callers. This component is that caller, and the backend rule it calls now matches
 * the moment a bill is actually presented.
 *
 * <h3>Why the two scopes are separated ON SCREEN and not just in the API</h3>
 *
 * A cashier holds {@code pos.order.discount.line} and not {@code pos.order.discount.override}.
 * That split is right — the person in front of the guest can take a line off, the whole check is
 * a manager's call. What was wrong was learning it from a 403 AFTER filling in the form, with the
 * raw permission string in the message. So the whole-check option is shown to everyone,
 * unselectable to a cashier, and says in one sentence who can do it instead. The rule is stated
 * before the work, not after it.
 *
 * <h3>Validation happens as they type</h3>
 *
 * Every refusal names the field and the real number: "10% of this line is more than the Rs 450.00
 * left on it", not "invalid amount". The submit button is disabled with the same sentence visible
 * — never disabled silently, which is the version of this control that teaches an operator
 * nothing.
 */
export function DiscountPanel({ order }: DiscountPanelProps) {
  const { permissions } = useCurrentUser();
  const canLine = permissions.includes(LINE_PERMISSION);
  const canWholeCheck = permissions.includes(WHOLE_CHECK_PERMISSION);

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("LINE");
  const [lineId, setLineId] = useState<string>("");
  const [type, setType] = useState<DiscountType>("PERCENT");
  const [valueText, setValueText] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const applyDiscount = useApplyDiscount(order.id);

  /** Only lines that are actually on the bill can be discounted. */
  const billableItems = useMemo(
    () => order.items.filter((i) => i.itemStatus !== "CANCELLED"),
    [order.items],
  );

  /**
   * A check stops being discountable once it is settled or written off — the same rule the
   * server enforces, stated here so the control is simply absent rather than offered and then
   * refused. Deliberately NOT a status whitelist copied by hand: CLOSED/VOIDED/REFUNDED are the
   * terminal three, everything else is live.
   */
  const isTerminal =
    order.status === "CLOSED" || order.status === "VOIDED" || order.status === "REFUNDED";
  const isDraft = order.status === "DRAFT";

  const selectedItem: OrderItem | undefined = billableItems.find((i) => i.id === lineId);

  /**
   * What is still discountable — the same base the server prices against, so the preview on
   * screen is the figure that will actually come off, not an estimate that turns out otherwise.
   */
  const lineDiscountsOnItem = (itemId: string) =>
    order.discounts
      .filter((d) => d.scope === "LINE" && d.orderItemId === itemId)
      .reduce((acc, d) => acc + d.amountPaisa, 0);

  const basePaisa = useMemo(() => {
    if (scope === "ORDER") {
      const lineTaken = billableItems.reduce(
        (acc, i) => acc + i.discountPaisa + lineDiscountsOnItem(i.id),
        0,
      );
      const orderTaken = order.discounts
        .filter((d) => d.scope === "ORDER")
        .reduce((acc, d) => acc + d.amountPaisa, 0);
      return Math.max(0, order.subtotalPaisa - lineTaken - orderTaken);
    }
    if (!selectedItem) return 0;
    const gross = selectedItem.unitPriceSnapshot * selectedItem.quantity;
    return Math.max(0, gross - selectedItem.discountPaisa - lineDiscountsOnItem(selectedItem.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedItem, billableItems, order.discounts, order.subtotalPaisa]);

  // ── validation, as they type ───────────────────────────────────────────────
  const rawValue = valueText.trim();
  const numericValue = rawValue === "" ? null : Number(rawValue);
  const valueIsNumber = numericValue !== null && Number.isFinite(numericValue);

  const amountOffPaisa = useMemo(() => {
    if (!valueIsNumber || numericValue === null || numericValue <= 0) return 0;
    if (type === "PERCENT") {
      return Math.min(basePaisa, Math.round((numericValue / 100) * basePaisa));
    }
    const paisa = parseRupeesToPaisa(rawValue);
    return paisa === null ? 0 : Math.min(basePaisa, paisa);
  }, [valueIsNumber, numericValue, type, basePaisa, rawValue]);

  const scopeError =
    scope === "ORDER" && !canWholeCheck
      ? `A discount on the whole check has to be approved by a manager. You can take an amount off an individual item; ask a manager to sign in for a whole-check discount.`
      : scope === "LINE" && billableItems.length === 0
        ? "There is nothing on this check to discount yet."
        : null;

  const lineError =
    scope === "LINE" && !lineId ? "Choose which item on the check the discount comes off." : null;

  const valueError = (() => {
    if (rawValue === "") return "Enter how much comes off.";
    if (!valueIsNumber) return `"${rawValue}" is not a number.`;
    if (numericValue !== null && numericValue <= 0) return "The discount has to be more than zero.";
    if (type === "PERCENT" && numericValue !== null && numericValue > 100) {
      return "A percentage cannot be more than 100.";
    }
    if (type === "FLAT" && parseRupeesToPaisa(rawValue) === null) {
      return `"${rawValue}" is not an amount in rupees.`;
    }
    if (basePaisa === 0) {
      return scope === "ORDER"
        ? "There is nothing left on this check to take off."
        : "That item has already been fully discounted.";
    }
    if (type === "FLAT") {
      const asked = parseRupeesToPaisa(rawValue);
      if (asked !== null && asked > basePaisa) {
        return `That is more than the ${formatPaisa(basePaisa)} left on ${
          scope === "ORDER" ? "this check" : "that item"
        }.`;
      }
    }
    return null;
  })();

  const reasonError =
    reason.trim().length === 0
      ? "Say why the discount is being given."
      : reason.trim().length < 3
        ? "Give a real reason — at least 3 characters."
        : null;

  const firstError = scopeError ?? lineError ?? valueError ?? reasonError;
  const canSubmit = !firstError && !applyDiscount.isPending;

  const newTotalPaisa = Math.max(0, order.totalPaisa - amountOffPaisa);

  const reset = () => {
    setOpen(false);
    setScope("LINE");
    setLineId("");
    setType("PERCENT");
    setValueText("");
    setReason("");
    setTouched(false);
    applyDiscount.reset();
  };

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) return;
    try {
      await applyDiscount.mutateAsync({
        scope,
        ...(scope === "LINE" ? { orderItemId: lineId } : {}),
        type,
        value: Number(rawValue),
        reason: reason.trim(),
      });
      reset();
    } catch {
      // Rendered below from applyDiscount.error — never swallowed, never a toast that scrolls away
      // while the operator is looking at the bill.
    }
  };

  /**
   * The server's refusals, in the operator's language.
   *
   * 403 is the important one: pos-service answers it with the raw policy string
   * (`Not permitted: pos.pos.order.discount.override` — the doubled prefix is a separate defect
   * owned by B2). A permission code on a till screen tells the person standing there nothing they
   * can act on, so it is replaced outright rather than appended to.
   *
   * 409 is passed THROUGH, because those messages are already written for this reader ("This
   * check has already been paid in full (Rs 998.00). Refund the guest instead of discounting
   * it.") — rewriting them here would be the second copy of a rule that could drift.
   */
  const serverError = (() => {
    const err = applyDiscount.error as { status?: number; message?: string } | null | undefined;
    if (!err) return null;
    if (err.status === 403) {
      return "A discount on the whole check has to be approved by a manager. Ask a manager to sign in and apply it.";
    }
    if (err.status === 409 || err.status === 422 || err.status === 400) {
      return err.message ?? "That discount was refused. Check the amount and try again.";
    }
    return "Couldn't apply the discount. Please try again.";
  })();

  const applied = order.discounts;

  // ── the applied list, always visible when there is one ────────────────────
  const appliedList = applied.length > 0 && (
    <ul data-testid="applied-discounts" className="flex flex-col gap-1.5">
      {applied.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {d.type === "PERCENT" && d.value !== null ? `${d.value}% off ` : "Off "}
              {d.scope === "ORDER" ? "the whole check" : (d.itemName ?? "one item")}
            </span>
            <span className="block text-muted-foreground">
              {d.reason ?? "No reason recorded"}
              {" · "}
              {/*
                An automatic promotion has no `appliedBy` — nobody pressed anything, the engine
                matched the customer's offer. Falling through to the generic actor line would
                print "Unknown", which reads as a missing audit record rather than as the truth,
                which is that this one was not a person's decision at all.
              */}
              {d.source === "PROMOTION"
                ? "Applied automatically"
                : (d.appliedByName ?? (d.appliedBy ? d.appliedBy.slice(0, 8) : "Unknown"))}
            </span>
          </span>
          <MoneyDisplay paisa={-d.amountPaisa} className="font-mono tabular-nums" />
        </li>
      ))}
    </ul>
  );

  if (isTerminal) {
    // Settled or written off — a discount is the wrong instrument and the control is gone. The
    // discounts already ON the check stay visible: a closed bill still has to explain itself.
    return applied.length > 0 ? <div className="flex flex-col gap-2">{appliedList}</div> : null;
  }

  if (!canLine && !canWholeCheck) {
    return applied.length > 0 ? <div className="flex flex-col gap-2">{appliedList}</div> : null;
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {appliedList}
        <button
          type="button"
          data-testid="add-discount-button"
          disabled={isDraft}
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl",
            "border text-sm font-medium transition-all",
            "hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Tag className="size-4" aria-hidden="true" />
          {applied.length > 0 ? "Add another discount" : "Apply a discount"}
        </button>
        {isDraft && (
          <p className="text-xs text-muted-foreground">
            Add something to the check before discounting it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="discount-panel"
      className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:p-4"
    >
      {appliedList}

      <h3 className="font-heading text-sm font-semibold">Apply a discount</h3>

      {/* ── scope ─────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-muted-foreground">What comes off</legend>
        <div className="flex flex-wrap gap-2">
          {(["LINE", "ORDER"] as const).map((s) => {
            const locked = s === "ORDER" && !canWholeCheck;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                data-testid={`discount-scope-${s.toLowerCase()}`}
                onClick={() => setScope(s)}
                className={cn(
                  "h-11 rounded-lg border px-3 text-sm transition-colors",
                  scope === s ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
                  locked && "opacity-70",
                )}
              >
                {s === "LINE" ? "One item" : "The whole check"}
                {locked && <span className="ml-1.5 text-xs">(manager)</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ── which line ────────────────────────────────────────────────────── */}
      {scope === "LINE" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Which item</span>
          <select
            data-testid="discount-line-select"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">Choose an item…</option>
            {billableItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.itemNameSnapshot} ×{i.quantity} —{" "}
                {formatPaisa(i.unitPriceSnapshot * i.quantity)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* ── how much ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(
            [
              ["PERCENT", "%"],
              ["FLAT", "Rs"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              data-testid={`discount-type-${t.toLowerCase()}`}
              onClick={() => setType(t)}
              className={cn(
                "h-10 min-w-11 rounded-lg border px-3 text-sm transition-colors",
                type === t ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            {type === "PERCENT" ? "Percent off" : "Amount off (Rs)"}
          </span>
          <input
            data-testid="discount-value-input"
            inputMode="decimal"
            value={valueText}
            onBlur={() => setTouched(true)}
            onChange={(e) => setValueText(e.target.value)}
            placeholder={type === "PERCENT" ? "10" : "150.00"}
            aria-invalid={touched && !!valueError}
            className={cn(
              "h-10 rounded-lg border bg-background px-3 text-sm",
              touched && valueError && "border-destructive",
            )}
          />
        </label>
      </div>

      {/* ── why ───────────────────────────────────────────────────────────── */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">
          Reason <span className="text-destructive">*</span>
        </span>
        <textarea
          data-testid="discount-reason-input"
          value={reason}
          rows={2}
          maxLength={200}
          onBlur={() => setTouched(true)}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Kebab was cold"
          aria-invalid={touched && !!reasonError}
          className={cn(
            "resize-none rounded-lg border bg-background px-3 py-2 text-sm",
            touched && reasonError && "border-destructive",
          )}
        />
      </label>

      {/* ── what it will do ───────────────────────────────────────────────── */}
      {amountOffPaisa > 0 && !firstError && (
        <p data-testid="discount-preview" className="text-xs text-muted-foreground">
          Takes <MoneyDisplay paisa={amountOffPaisa} className="font-medium text-foreground" /> off
          — new total <MoneyDisplay paisa={newTotalPaisa} className="font-medium text-foreground" />
          .
        </p>
      )}

      {/* ── the one thing standing in the way, always named ────────────────── */}
      {firstError && (
        <p
          data-testid="discount-validation-error"
          role={touched ? "alert" : undefined}
          className={cn(
            "text-xs",
            scopeError ? "text-foreground" : "text-destructive",
            !touched && !scopeError && "text-muted-foreground",
          )}
        >
          {firstError}
        </p>
      )}

      {serverError && (
        <p data-testid="discount-server-error" role="alert" className="text-xs text-destructive">
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-lg border px-4 text-sm hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="apply-discount-submit"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className={cn(
            // h-11 = 44px. This is pressed with a thumb, on a greasy screen, with a queue
            // behind it; 38px (px-4 py-2) is a mouse target, not a till one.
            "inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Percent className="size-3.5" aria-hidden="true" />
          {applyDiscount.isPending ? "Applying…" : "Apply discount"}
        </button>
      </div>
    </div>
  );
}

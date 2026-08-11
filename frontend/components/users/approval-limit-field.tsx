"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { formatPaisa } from "@/lib/adapters/shared";

/**
 * The approval limit, set by a human, in paisa.
 *
 * <h3>Why this component exists</h3>
 *
 * `user_branch_roles.approval_limit_paisa` was NULL on every row and unsettable from anywhere
 * inside the product. `vendor.rego`, `finance.rego` and `pos.rego` all compare a resource amount
 * against that attribute, and a Rego comparison against an undefined value is not satisfied — so
 * nobody, not even the OWNER, could approve a purchase order. It presented for months as a
 * permission bug and was never one: it was fail-closed behaviour on a column with no filling
 * mechanism. A seed script eventually wrote the numbers, which is not a product.
 *
 * D-36-03: an owner sets these in the UI. No SQL, no seed, no support ticket.
 *
 * <h3>Three things this owns, and they are the whole reason it is a component</h3>
 *
 * 1. <b>The presentation boundary.</b> Paisa are integers everywhere — state, payload, comparison.
 *    Exactly one place divides by 100, and it is for display only. This project has already
 *    shipped a 1000×-wrong COGS from a floating-point value near money; a limit held as
 *    `12500.50` and multiplied back to `1250049.999…` would be the same defect wearing different
 *    clothes.
 * 2. <b>Validation:</b> a non-negative whole number of paisa, or nothing.
 * 3. <b>The distinction between "no approval authority" and "a limit of zero".</b> The policies
 *    deny every positive amount for both — see `policies/tests/approval_gated_actions_test.rego`,
 *    which asserts exactly that — but they mean different things to a person, and an interface
 *    that conflates them lets someone believe they granted an authority they did not. The
 *    identity is stated in the help text rather than hidden.
 */

/**
 * The permissions whose policy rule compares a resource amount against `approval_limit_paisa`.
 *
 * Source of truth, all three:
 *   - `policies/restaurantos/vendor.rego`  — `approve_po`
 *   - `policies/restaurantos/finance.rego` — `approve`
 *   - `policies/restaurantos/pos.rego`     — `pos.order.refund`
 *
 * `policies/tests/approval_gated_actions_test.rego` pins this set from the policy side: it proves
 * each of these is amount-gated by construction (allowed with a limit, denied without), proves
 * `close_po` and `pos.order.discount.override` are NOT, and fails if the set changes size. A
 * fourth amount-gated action therefore breaks that test rather than silently producing a form
 * that forgot to ask for a number.
 */
export const AMOUNT_GATED_PERMISSIONS: readonly string[] = [
  "vendor.po.approve",
  "finance.expense.approve",
  "pos.order.refund",
];

/**
 * Whether a role needs an approval-limit decision.
 *
 * Driven off the role's own permission list — which `GET /api/v1/roles` already returns — and
 * never off a role code. A tenant's custom role holding `vendor.po.approve` needs the field
 * exactly as much as the built-in MANAGER does, and a hardcoded list of role codes is how the
 * custom one silently gets a NULL limit and a user who cannot approve anything.
 */
export function roleNeedsApprovalLimit(permissions: readonly string[] | undefined): boolean {
  if (!permissions) return false;
  return permissions.some((p) => AMOUNT_GATED_PERMISSIONS.includes(p));
}

/**
 * The value this field produces.
 *
 * `"none"` and a `paisa` of `0` are deliberately different states. `"unset"` is neither — it is
 * the initial state, and it blocks submission for a role that needs a decision.
 */
export type ApprovalLimitValue =
  | { kind: "unset" }
  | { kind: "none" }
  | { kind: "limit"; paisa: number };

export function isApprovalLimitDecided(value: ApprovalLimitValue): boolean {
  return value.kind !== "unset";
}

/** The value to send as `approvalLimitPaisa`: an integer, or `null` for no approval authority. */
export function approvalLimitPayloadValue(value: ApprovalLimitValue): number | null {
  return value.kind === "limit" ? value.paisa : null;
}

/**
 * Parse what a person typed, in RUPEES, into integer paisa.
 *
 * Rupees rather than paisa is the honest input unit — nobody thinks in paisa — but the conversion
 * happens here, once, by string manipulation rather than `Math.round(x * 100)`. `19.99 * 100` is
 * `1998.9999999999998` in IEEE 754; rounding rescues that particular case and does not rescue the
 * general one, and "it works for the values I tried" is exactly how the 1000× COGS shipped.
 */
export function parseRupeesToPaisa(raw: string): { paisa: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "Enter an amount, or choose no approval authority." };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      error: "Enter a non-negative amount with at most two decimal places (for example 25000.00).",
    };
  }
  const [rupees, fraction = ""] = trimmed.split(".");
  const paisaPart = fraction.padEnd(2, "0");
  const paisa = Number(rupees) * 100 + Number(paisaPart);
  if (!Number.isSafeInteger(paisa)) {
    return { error: "That amount is too large." };
  }
  return { paisa };
}

/** Integer paisa → the string the input shows. The only division by 100 in this file. */
export function paisaToRupeeInput(paisa: number): string {
  const negative = paisa < 0;
  const abs = Math.abs(Math.trunc(paisa));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  return `${negative ? "-" : ""}${major}.${String(minor).padStart(2, "0")}`;
}

export function ApprovalLimitField({
  value,
  onChange,
  id = "approval-limit",
  roleLabel,
}: {
  value: ApprovalLimitValue;
  onChange: (next: ApprovalLimitValue) => void;
  id?: string;
  /** The role being assigned, for the help text. */
  roleLabel?: string;
}) {
  const [text, setText] = React.useState(() =>
    value.kind === "limit" ? paisaToRupeeInput(value.paisa) : "",
  );
  const [error, setError] = React.useState<string | null>(null);

  function chooseNone() {
    setText("");
    setError(null);
    onChange({ kind: "none" });
  }

  function handleAmount(raw: string) {
    setText(raw);
    if (raw.trim() === "") {
      setError(null);
      onChange({ kind: "unset" });
      return;
    }
    const parsed = parseRupeesToPaisa(raw);
    if ("error" in parsed) {
      setError(parsed.error);
      onChange({ kind: "unset" });
      return;
    }
    setError(null);
    onChange({ kind: "limit", paisa: parsed.paisa });
  }

  return (
    <div className="space-y-1.5" data-testid="approval-limit-field">
      <Label htmlFor={id}>Approval limit</Label>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Rs</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="0.00"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(e) => handleAmount(e.target.value)}
          onFocus={() => {
            // Typing an amount supersedes an earlier "no authority" choice.
            if (value.kind === "none") onChange({ kind: "unset" });
          }}
          className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-sm transition-colors focus-visible:border-ring dark:bg-surface-2"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={`${id}-authority`}
          data-testid="approval-limit-none"
          checked={value.kind === "none"}
          onChange={chooseNone}
        />
        <span>No approval authority</span>
      </label>

      {error && (
        <p role="alert" data-testid="approval-limit-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {roleLabel ? `${roleLabel} can approve amounts up to this limit. ` : ""}
        The limit is compared against the amount of each request, so a limit of Rs 0.00 and no
        approval authority both refuse every approval — they are kept apart here because they say
        different things about what you intended.
        {value.kind === "limit" && (
          <>
            {" "}
            This role will be able to approve up to{" "}
            <strong data-testid="approval-limit-preview">{formatPaisa(value.paisa)}</strong>.
          </>
        )}
      </p>
    </div>
  );
}

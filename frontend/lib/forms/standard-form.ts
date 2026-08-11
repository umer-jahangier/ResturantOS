"use client";

import * as React from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { ZodType } from "zod";

import { createZodResolver } from "./zod-resolver";

/**
 * The one form hook the app uses (D-35-02, D-35-04).
 *
 * <h2>What was actually wrong</h2>
 *
 * The stack was never missing. react-hook-form, zod, `createZodResolver` and a full
 * `Form`/`FormField`/`FormMessage` set were all present and used by twenty-odd dialogs. What was
 * missing was two lines of configuration: **not one `useForm` call in the codebase set `mode`**,
 * so every form in the product used react-hook-form's default and validated only on submit. A user
 * filled in nine fields, pressed Save, and was then told about the second one. That is precisely
 * the experience the user described as "no form validations on run-time".
 *
 * <h2>Why onTouched and not onChange</h2>
 *
 * This is the entire disagreement with today's behaviour, so the reasoning lives where it is set.
 *
 * Pure `onChange` validates from the first keystroke, which means typing the "A" of a name shows
 * "Name is required" and then clears it — a form that argues with someone who is in the middle of
 * complying with it. `onTouched` waits for the first blur, so the user gets to finish a thought
 * before being corrected.
 *
 * `reValidateMode: "onChange"` then makes every keystroke AFTER that first blur live, which is
 * what D-35-02 asks for: the error clears on the character that fixes it, not at the next submit.
 *
 * The rule itself is shown BEFORE it can be broken by `FormHint`, which renders persistently and
 * is not an error. "8–12 digits" sitting under an empty field is guidance; the same sentence in
 * red after a failed submit is a reprimand for something the user was never told.
 *
 * <h2>Debouncing</h2>
 *
 * Deliberately absent. Synchronous zod rules are cheap and running one per keystroke is not what
 * makes a form feel slow. Reserve `use-debounced-value` (already in the codebase — do not add a
 * third debounce primitive) for rules that hit the NETWORK, such as a uniqueness check. A
 * debounced string-length rule just feels broken.
 */

export interface StandardFormOptions<TValues extends FieldValues>
  extends Omit<UseFormProps<TValues>, "resolver" | "mode" | "reValidateMode"> {
  schema: ZodType<TValues>;
  defaultValues: DefaultValues<TValues>;
}

/** What a submit control needs and no form in the codebase currently computes. */
export interface SubmitState {
  /** True when the form may be submitted right now. */
  canSubmit: boolean;
  /**
   * Why it may not be, in a sentence naming what is unfinished — or `null` when it may.
   *
   * A disabled button with no explanation is the second-worst control in a UI (the worst being an
   * enabled one that does nothing). D-35-02 requires the reason to be stated.
   */
  reason: string | null;
  /** Field paths currently holding an error, for a caller that wants to render its own summary. */
  invalidFields: string[];
}

export interface StandardForm<TValues extends FieldValues> extends UseFormReturn<TValues> {
  submitState: SubmitState;
}

export function useStandardForm<TValues extends FieldValues>({
  schema,
  defaultValues,
  ...options
}: StandardFormOptions<TValues>): StandardForm<TValues> {
  const form = useForm<TValues>({
    ...options,
    defaultValues,
    resolver: createZodResolver(schema),
    // The two settings this whole hook exists for. See the class comment.
    mode: "onTouched",
    reValidateMode: "onChange",
  });

  // Subscribing to these individually is what makes the component re-render as validity changes;
  // react-hook-form's formState is a Proxy that tracks which fields were read.
  const { errors, isSubmitting, isValidating } = form.formState;

  const submitState = React.useMemo<SubmitState>(() => {
    const invalidFields = Object.keys(errors).filter((key) => key !== "root");

    if (isSubmitting) {
      return { canSubmit: false, reason: "Saving…", invalidFields };
    }
    if (isValidating) {
      return { canSubmit: false, reason: "Checking…", invalidFields };
    }
    if (invalidFields.length > 0) {
      return {
        canSubmit: false,
        reason: describeInvalidFields(invalidFields),
        invalidFields,
      };
    }
    return { canSubmit: true, reason: null, invalidFields };
  }, [errors, isSubmitting, isValidating]);

  return Object.assign(form, { submitState });
}

/**
 * Names the fields rather than counting them where the list is short enough to read.
 *
 * "Fix 2 fields" tells the user there is a problem and nothing about where. Three names fit
 * comfortably in a sentence; beyond that a count is genuinely more useful than a list, and the
 * per-field messages are still on screen.
 */
function describeInvalidFields(fields: string[]): string {
  const labels = fields.map(humanizeFieldPath);
  if (labels.length === 1) {
    return `Fix ${labels[0]} to continue`;
  }
  if (labels.length <= 3) {
    return `Fix ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} to continue`;
  }
  return `Fix ${labels.length} fields to continue`;
}

/** `basicSalaryPaisa` → "basic salary paisa"; `slabs.0.ratePct` → "slabs 1 rate pct". */
function humanizeFieldPath(path: string): string {
  return path
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? String(Number(segment) + 1) : segment))
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id, required } = itemContext;

  return {
    id,
    required,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

type FormItemContextValue = {
  id: string;
  required: boolean;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

/**
 * One field: label, control, hint, message — and, from 38-15, whether it is REQUIRED.
 *
 * <h3>Why `required` is declared here and not on the label or the input</h3>
 *
 * The audit measured `requiredMarked: 0` in both dialogs it probed (UI-SPEC §11, brief §22): no
 * asterisk, no `aria-required`, nothing — so on a nine-field vendor form the only way to learn
 * which three fields were mandatory was to press Save and be told. 38-03 recorded this as
 * explicitly NOT built and left it to this plan.
 *
 * <p>The obvious placement is a `required` prop on the input, which is where HTML puts it. That
 * was rejected: the *visible* marker has to render in the LABEL and the *programmatic* flag has
 * to land on the CONTROL, and those are two different elements with no relationship except this
 * component. Declaring it once on the item is the only position from which both can be derived,
 * so the two cannot disagree — the failure mode being a red asterisk beside a field with no
 * `aria-required`, which tells a sighted user the truth and a screen-reader user nothing.
 *
 * <p>Deliberately NOT inferred from the zod schema. It is derivable in the simple case and wrong
 * in every interesting one — a field required only when another is set, a `.optional()` wrapping
 * a `.min(1)` — and a marker that is right 80 % of the time is worse than one a caller states,
 * because nobody can tell which 20 % they are looking at.
 *
 * <p>Default `false`, so the twenty-odd existing call sites render byte-identically.
 */
function FormItem({
  className,
  required = false,
  ...props
}: React.ComponentProps<"div"> & { required?: boolean }) {
  const id = React.useId();
  const value = React.useMemo(() => ({ id, required }), [id, required]);

  return (
    <FormItemContext.Provider value={value}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}

/**
 * The label, and — when the item declares itself required — the visible marker.
 *
 * <h3>Colour is never the only channel (D-38-13, UI-SPEC §4.2)</h3>
 *
 * `activity-row.tsx` and `stat-tile.tsx` already agree the second channel must be **visible**,
 * not `sr-only`, because "`sr-only` serves only the reader who was never at risk from hue".
 * This extends that agreement rather than re-opening it: the marker is a **glyph** — a shape
 * channel, legible on a monochrome remote session and to a protanopic reader — and it is
 * rendered in `text-destructive` only as a third, redundant cue. Strip the colour and the
 * asterisk is still there; strip the asterisk and `aria-required` is still there.
 *
 * <p>The asterisk is `aria-hidden`, and that is a choice rather than an oversight. `FormControl`
 * sets `aria-required` on the control itself, which is what every screen reader announces at the
 * point the user arrives in the field. Leaving the glyph exposed as well would announce "star"
 * — or, with a `sr-only` "(required)" beside it, announce required TWICE per field, which on a
 * nine-field dialog is eighteen redundant words. One channel per audience, both always present.
 */
function FormLabel({ className, children, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId, required } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      data-required={required ? "true" : undefined}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      {required ? (
        <span
          aria-hidden="true"
          data-slot="form-required-marker"
          className="-ml-1 text-destructive"
        >
          *
        </span>
      ) : null}
    </Label>
  );
}

/**
 * The wiring that makes a field's state programmatic (UI-SPEC §11, brief §22).
 *
 * <p>`aria-invalid` and `aria-describedby` were already here — the error message is named by the
 * field rather than merely sitting near it, which is what makes it reachable. `aria-required` is
 * new, and it is derived from the same `FormItem` declaration that draws the asterisk, so the
 * visible marker and the announced one cannot drift apart.
 *
 * <p>`undefined` rather than `false` when the field is optional: `aria-required="false"` is legal
 * and inert, but it puts an attribute on every control in the product to say nothing, and a gate
 * that greps for `aria-required` would then match all of them.
 */
function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId, required } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      aria-required={required ? true : undefined}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {body}
    </p>
  );
}

/**
 * The rule for a field, stated BEFORE it can be broken (D-35-02).
 *
 * <p>This is the half of live validation that is not an error message. "8–12 digits" sitting under
 * an empty field is guidance; the identical sentence in red after a failed submit is a reprimand
 * for a rule the user was never told. So this renders persistently and does NOT disappear when the
 * field becomes invalid — the error appears alongside it, not instead of it.
 *
 * <p>Distinct from {@link FormDescription} only in that it is aimed at the input's CONSTRAINT
 * rather than its meaning, and shares the same describedby wiring so a screen reader gets it
 * before the user starts typing rather than after they fail.
 */
function FormHint({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-hint"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

/**
 * A submit control that is disabled for a stated reason (D-35-02).
 *
 * <p>A disabled button with no explanation is the second-worst control in a UI, after an enabled
 * one that does nothing. The user is told "no" and left to guess which of nine fields is the
 * problem — which is exactly the experience this phase exists to remove.
 *
 * <p>The reason is rendered as TEXT associated with the button through `aria-describedby`, not as
 * a `title` attribute. A title is invisible on touch, invisible to keyboard users who never hover,
 * and inconsistently announced by screen readers; it is the standard way to record an explanation
 * that nobody receives.
 *
 * <p>`submitState` comes from `useStandardForm`, which derives it from react-hook-form's own
 * formState — so it cannot drift from what the resolver believes.
 */
function FormSubmitButton({
  submitState,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  submitState: { canSubmit: boolean; reason: string | null };
}) {
  const reasonId = React.useId();
  const { canSubmit, reason } = submitState;

  return (
    // 38-14: `justify-items-end` from `md` up, `stretch` below it. On a phone the submit button
    // is the last thing a thumb reaches for and it was a ~120px box hugging the right edge; full
    // width is the same control with a target a thumb can hit without aiming. Above `md` nothing
    // moves — the right-aligned button is what a form on a desk should look like.
    //
    // `justify-items`, not a width on the Button: the disabled-reason paragraph below shares this
    // grid, and stretching the button by hand would have left the explanation right-aligned under
    // a full-width control.
    <div className="grid justify-items-stretch gap-1 md:justify-items-end">
      <Button
        type="submit"
        data-slot="form-submit"
        disabled={!canSubmit}
        aria-describedby={!canSubmit && reason ? reasonId : undefined}
        className={className}
        {...props}
      >
        {children}
      </Button>
      {!canSubmit && reason ? (
        <p id={reasonId} data-slot="form-submit-reason" className="text-muted-foreground text-xs">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
  FormHint,
  FormSubmitButton,
};

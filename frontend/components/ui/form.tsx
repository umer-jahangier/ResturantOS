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

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
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
    <div className="grid gap-1 justify-items-end">
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

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useForcedPasswordChange } from "@/lib/hooks/auth/use-forced-password-change";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * The forced-password-change step (D-17's missing half).
 *
 * <h3>Why this is a panel and no longer a page (F12)</h3>
 *
 * It used to live at `/login/change-password`, and the only way to get the single-use change token
 * there was `?token=…&email=…`. A URL is the worst carrier a credential can have: it is written to
 * browser history, sent as the `Referer` of the next request the page makes, and recorded verbatim
 * by every proxy, CDN and access log between the browser and the gateway. The walkthrough caught a
 * new hire meeting exactly that on their first minute in the product.
 *
 * So the token never enters a URL. This renders INSIDE the login form, in the same slot as
 * `TotpEnrollment`, and receives the token as a prop from the component that was handed it — the
 * refusal handler. That is the same reasoning `login-form.tsx` already records for keeping the
 * password in form state during TOTP enrolment: a URL, `sessionStorage` and a global store are all
 * worse homes for a live credential than the React state it is already in.
 *
 * Leaving the page discards the token, which is correct: a change token is only ever minted for
 * someone who has just proved the current password, so getting another one costs one sign-in.
 *
 * <h3>Why `onChanged` hands the new password back (F19)</h3>
 *
 * `POST /api/v1/auth/change-password/forced` issues no access token and sets no refresh cookie
 * (13-08) — it changes a password and nothing else — so this component cannot and must not
 * fabricate a session. But the caller needs one, and the walkthrough caught what happens when the
 * credential is dropped on the floor here: the new hire was handed back an empty password box and
 * told to retype the password they had chosen ten seconds earlier.
 *
 * So the password travels UP, in an argument, to the component that owns the sign-in. Same
 * reasoning as the token travelling DOWN in a prop: a live credential belongs in the React state of
 * the flow that is using it, not in a URL, `sessionStorage` or a store. The caller signs in with it
 * through the ordinary login endpoint, which is the only place the TOTP step-up gate lives.
 */

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter the password you were given"),
    // The server is the authority on strength (`@StrongPassword` on ForcedPasswordChangeRequest).
    // The client only catches the trivially-wrong so the change token is not spent on a 400.
    newPassword: z.string().min(12, "Use at least 12 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type Values = z.infer<typeof schema>;

interface Props {
  /**
   * The single-use change token from the 403's `details`. Required, and passed in memory — there
   * is deliberately no way for this component to read one out of the URL.
   */
  changeToken: string;
  /**
   * The password the user just signed in with. It verified — the 403 is thrown only after the
   * comparison succeeds — so prefilling it is not a guess, and it saves a new hire retyping a
   * 16-character one-time password they were handed on paper. The field stays visible and editable
   * because the user, not this component, is the authority on what they typed.
   */
  currentPassword?: string;
  /**
   * Called after the server has accepted the new password, WITH that password (F19).
   *
   * The caller signs in with it immediately, so the user is never asked to type it a second time.
   * It is passed rather than re-read because this form's state is destroyed the moment the caller
   * unmounts it, which it does as soon as this fires.
   */
  onChanged: (newPassword: string) => void;
  /** Called when the user backs out; the caller is expected to discard the token. */
  onCancel: () => void;
}

export function ForcedPasswordChangeForm({
  changeToken,
  currentPassword,
  onChanged,
  onCancel,
}: Props) {
  const change = useForcedPasswordChange();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: createZodResolver(schema),
    defaultValues: {
      currentPassword: currentPassword ?? "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  function onSubmit(values: Values) {
    setFormError(null);
    change.mutate(
      {
        changeToken,
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => onChanged(values.newPassword),
        onError: (error) => {
          if (error.isPasswordReuse()) {
            const message = "Choose a password you have not used before.";
            setFormError(message);
            return;
          }
          if (error.isValidationFailed()) {
            // The server's strength policy is the authority. Surface its per-field reasons rather
            // than a generic message, so the user can actually satisfy it.
            const detail = error.fieldErrors.map((f) => f.issue).join(" ");
            setFormError(detail || error.message);
            return;
          }
          if (error.isUnauthenticated()) {
            setFormError(
              "That link has expired or the current password is wrong. Sign in again to get a new link.",
            );
            return;
          }
          setFormError(error.message || "Something went wrong. Please try again.");
        },
      },
    );
  }

  return (
    <div className="grid gap-4" data-testid="forced-password-change">
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not change password</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={change.isPending} className="w-full">
            {change.isPending ? "Saving…" : "Change password"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={change.isPending}>
            Back to sign in
          </Button>
        </form>
      </Form>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useForcedPasswordChange } from "@/lib/hooks/auth/use-forced-password-change";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
 * The forced-password-change screen (D-17's missing half).
 *
 * Reached only from a `403 PASSWORD_CHANGE_REQUIRED`, carrying the single-use change token that
 * refusal supplied. On success it sends the user back to `/login` to sign in with the password they
 * just chose — deliberately NOT straight into the app: the change endpoint issues no token and no
 * refresh cookie (13-08), and pretending otherwise would mean inventing a session the user has not
 * authenticated for.
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
  /** From `?token=`. Null when the page was opened directly, which is not a usable state. */
  changeToken: string | null;
  email: string | null;
  tenantSlug: string | null;
  returnPath: string | null;
}

export function ForcedPasswordChangeForm({ changeToken, email, tenantSlug, returnPath }: Props) {
  const router = useRouter();
  const change = useForcedPasswordChange();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: createZodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  if (!changeToken) {
    // Arriving here without a token means the refusal that mints one never happened. Say so
    // plainly rather than rendering a form that cannot succeed.
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing to change here</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            This page is only reachable from a sign-in that requires a password change. Start at the
            sign-in screen.
          </p>
          <Button type="button" onClick={() => router.push("/login")}>
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  function onSubmit(values: Values) {
    setFormError(null);
    change.mutate(
      {
        changeToken: changeToken!,
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => {
          toast.success("Password changed. Sign in with your new password.");
          const query = new URLSearchParams();
          if (tenantSlug) query.set("tenant", tenantSlug);
          if (returnPath) query.set("next", returnPath);
          const suffix = query.toString();
          router.push(suffix ? `/login?${suffix}` : "/login");
        },
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
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          {email
            ? `${email} must set its own password before signing in.`
            : "This account must set its own password before signing in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {formError ? (
          <Alert variant="destructive" className="mb-4">
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
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

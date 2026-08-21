"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useChangeOwnPassword } from "@/lib/hooks/use-user-profile";
import { useLogout } from "@/lib/hooks/auth/use-logout";
import { ApiError, formatUserFacingError } from "@/lib/errors";

/**
 * Self-service password change — the second half of GA-019.
 *
 * <p>`POST /api/v1/auth/change-password` shipped in plan 13-04 and only the FORCED variant was ever
 * wired (`session.repository.ts`), so a signed-in user had no way to change their own password
 * although the endpoint had existed and been tested for months.
 *
 * <h3>The rules below are auth-service's, mirrored — not invented here</h3>
 *
 * `@StrongPassword` (shared-lib): at least 8 characters, at most 128, and at least one lowercase
 * letter, one uppercase letter, one digit and one non-alphanumeric character. Whitespace counts as
 * the symbol, deliberately, so a passphrase is not pushed towards being shorter and denser.
 * Mirroring it client-side turns a round trip into an inline message; the server still enforces it,
 * and the server also enforces the two rules a browser cannot know: reuse of a previous password,
 * and that the current password is correct.
 *
 * <h3>Why success ends the session</h3>
 *
 * `changeOwnPassword` calls `revokeActiveRefreshSessions(userId)`, which revokes EVERY unrevoked
 * refresh session for the user — including this browser's. The access token in memory keeps working
 * until it expires and then the next refresh fails. Leaving the user in that state means the app
 * logs them out at an unpredictable moment, minutes later, for no reason they can see. So the
 * change is followed by an explicit "you have been signed out everywhere" panel and a deliberate
 * sign-out, which is the same fact told in advance instead of sprung.
 */

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "At least 8 characters")
      .max(128, "At most 128 characters")
      .regex(/\p{Ll}/u, "Include a lowercase letter")
      .regex(/\p{Lu}/u, "Include an uppercase letter")
      .regex(/\d/u, "Include a digit")
      .regex(/[^\p{L}\p{N}]/u, "Include a symbol"),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The two new passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Choose a password you have not used here before",
    path: ["newPassword"],
  });

type Values = z.infer<typeof schema>;

/**
 * `UNAUTHENTICATED` does NOT mean "your session died" on this endpoint.
 *
 * <p>Measured in the browser on 2026-08-11, signed in as a MANAGER, submitting a deliberately wrong
 * current password: the form rendered <b>"Please sign in again."</b> That is the shared
 * `formatUserFacingError` mapping for `UNAUTHENTICATED`, and it is right almost everywhere — a 401
 * usually does mean the token is finished. Here it does not. `changeOwnPassword` throws
 * `AuthenticationFailedException` with a deliberately GENERIC message when
 * `passwordEncoder.matches` fails, so the same code carries "your password is wrong". Telling the
 * user to sign in again sends them to do the one thing that cannot help, and hides the one thing
 * they can fix.
 *
 * <p>Mapped locally rather than in `lib/errors/user-facing.ts` because the correct wording depends
 * on which endpoint answered: changing the shared map would make every genuinely expired session in
 * the app say "check your current password".
 *
 * <p>Two smaller notes, both from reading auth-service rather than guessing:
 *
 * <ul>
 *   <li>A wrong guess here does NOT count towards a lockout. `changeOwnPassword` deliberately skips
 *       failed-attempt accounting so that anyone holding a stolen access token cannot lock the real
 *       owner out by guessing badly. So the reassurance below is true.</li>
 *   <li>`PASSWORD_REUSE` is a 400 with its own code and gets its own sentence: "try again" is
 *       useless advice for a rule that will refuse the same value forever.</li>
 * </ul>
 */
function changePasswordMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isPasswordReuse()) {
      return "That is a password you have used here before. Choose a different one.";
    }
    if (error.isUnauthenticated() || error.status === 401) {
      return "That current password is not right. Check it and try again — a wrong guess here does not lock your account.";
    }
  }
  return formatUserFacingError(error);
}

export function ChangePasswordForm() {
  const change = useChangeOwnPassword();
  const logout = useLogout();
  const [done, setDone] = useState(false);

  const form = useForm<Values>({
    resolver: createZodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  function onSubmit(values: Values) {
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          form.reset();
          setDone(true);
        },
      },
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            Password changed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4" role="status">
          <p className="text-small text-muted-foreground">
            Every signed-in session was ended, including this one. Sign in again with your new
            password.
          </p>
          <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? "Signing out…" : "Sign in again"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
        <CardDescription>
          You will be signed out of every device, including this one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="current-password" />
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
                    <Input {...field} type="password" autoComplete="new-password" />
                  </FormControl>
                  <FormDescription>
                    At least 8 characters, with an uppercase letter, a lowercase letter, a digit and
                    a symbol.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repeat new password</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {change.isError && (
              // A wrong current password and a reused password are two different refusals and the
              // user can act on the difference. See `changePasswordMessage` for why the shared
              // mapping is wrong on this one endpoint.
              <p
                role="alert"
                data-testid="change-password-error"
                className="text-small text-destructive"
              >
                {changePasswordMessage(change.error)}
              </p>
            )}

            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

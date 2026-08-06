"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useLogin } from "@/lib/hooks/auth/use-login";
import { STEP_UP_LOGIN_REASON, sanitizeReturnPath } from "@/lib/auth/step-up";
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

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  // Revealed only after the auth-service requests a TOTP step-up.
  totpCode: z.string().optional(),
  // Only collected when the tenant slug could not be resolved server-side.
  tenantSlug: z.string().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  /** Resolved from the subdomain / `?tenant=`; null when neither yielded a slug. */
  tenantSlug: string | null;
  /** Display name from auth-service (e.g. Lume); falls back to slug. */
  tenantBrandName?: string | null;
  /** `?reason=` hint (e.g. `session_expired`, `step_up_required`) surfaced as a one-line notice. */
  reason?: string;
  /**
   * Where to land after a successful sign-in, when the user was sent here mid-task — a
   * step-up-gated action that needs a fresh `totp_verified` claim. Already sanitised to a
   * same-origin path by the page; null means the default dashboard.
   */
  returnPath?: string | null;
}

export function LoginForm({ tenantSlug, tenantBrandName, reason, returnPath }: LoginFormProps) {
  const router = useRouter();
  const login = useLogin();

  const [totpRequired, setTotpRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const needsTenantInput = !tenantSlug;

  const form = useForm<LoginFormValues>({
    resolver: createZodResolver(loginSchema),
    defaultValues: { email: "", password: "", totpCode: "", tenantSlug: "" },
  });

  function onSubmit(values: LoginFormValues) {
    setFormError(null);

    const slug = (tenantSlug ?? values.tenantSlug ?? "").trim();
    if (!slug) {
      form.setError("tenantSlug", {
        type: "manual",
        message: "Enter your restaurant identifier to continue",
      });
      return;
    }

    const totpCode = values.totpCode?.trim();

    login.mutate(
      {
        email: values.email,
        password: values.password,
        tenantSlug: slug,
        ...(totpCode ? { totpCode } : {}),
      },
      {
        onSuccess: () => {
          // Re-sanitised at the point of use: the prop is the only thing standing between a
          // URL-supplied `?next=` and a post-login redirect, and this is the redirect.
          router.push(sanitizeReturnPath(returnPath) ?? "/app/dashboard");
        },
        // `error` is typed as the live `ApiError` via the useLogin mutation —
        // we never import the api-client class directly (FE-08 boundary).
        onError: (error) => {
          if (error.isTotpRequired()) {
            // FD-2 O→P→Q→R: reveal the TOTP field, keep email/password, resubmit.
            setTotpRequired(true);
            setFormError(null);
            window.setTimeout(() => form.setFocus("totpCode"), 0);
            return;
          }

          if (error.isTotpEnrollmentRequired()) {
            // The account must use a second factor and has never enrolled one, so there is no
            // code to ask for. Revealing the TOTP field here would strand them at a prompt they
            // cannot satisfy — say what is actually required instead.
            const message =
              "This account requires two-factor authentication, which has not been set up yet. " +
              "Ask an administrator to complete enrolment before signing in.";
            setTotpRequired(false);
            setFormError(message);
            toast.error(message);
            return;
          }

          if (error.isAccountLocked()) {
            // HTTP 423 — distinct, recoverable state.
            const message = "Account temporarily locked. Try again later.";
            setFormError(message);
            toast.error(message);
            return;
          }

          if (error.isUnauthenticated()) {
            // 401 — generic by design (also masks suspended/non-ACTIVE tenants;
            // never claim to distinguish "suspended" vs "bad password").
            setFormError("Invalid email or password.");
            return;
          }

          setFormError(error.message || "Something went wrong. Please try again.");
        },
      },
    );
  }

  const restaurantLabel = tenantBrandName ?? tenantSlug;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {restaurantLabel ? `Sign in to ${restaurantLabel}` : "Sign in to RestaurantOS"}
        </CardTitle>
        <CardDescription>
          {tenantSlug
            ? "Enter your email and password to continue"
            : "Enter your restaurant identifier and credentials"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reason === "session_expired" ? (
          <p className="mb-4 text-sm text-muted-foreground" role="status">
            Your session expired. Please sign in again.
          </p>
        ) : null}

        {/* Distinct from session_expired on purpose: nothing expired that the user did wrong,
            and telling them their session ended when it did not invites a support call. */}
        {reason === STEP_UP_LOGIN_REASON ? (
          <p className="mb-4 text-sm text-muted-foreground" role="status">
            That action needs a fresh authenticator code. Sign in again to continue — you&apos;ll
            be asked for your code, then taken back to where you were.
          </p>
        ) : null}

        {formError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            {needsTenantInput ? (
              <FormField
                control={form.control}
                name="tenantSlug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Restaurant</FormLabel>
                    <FormControl>
                      <Input placeholder="your-restaurant" autoComplete="organization" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {totpRequired ? (
              <FormField
                control={form.control}
                name="totpCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Authenticator code</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        aria-describedby="totp-hint"
                        {...field}
                      />
                    </FormControl>
                    <p id="totp-hint" className="text-sm text-muted-foreground">
                      Enter your authenticator code to finish signing in.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <Button type="submit" disabled={login.isPending} className="w-full">
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

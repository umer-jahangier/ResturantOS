"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useLogin } from "@/lib/hooks/auth/use-login";
import { STEP_UP_LOGIN_REASON, sanitizeReturnPath } from "@/lib/auth/step-up";
import { PLATFORM_CHOICE, type Session } from "@/lib/models/auth.model";
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
 * ONE login form, for everyone.
 *
 * Before 16a-01 there were effectively two logins and one of them had no UI at all: the form
 * REQUIRED a restaurant slug (so a user had to know an identifier they were never given), and the
 * SuperAdmin — who belongs to no tenant and authenticates against a different endpoint — had no way
 * in through the browser at all.
 *
 * Now: email and password. Nothing else, in the normal case. The server verifies the credential and
 * then works out where it authenticated. The restaurant field survives only as an ADVANCED escape
 * hatch, and `tenantSlug` (from a subdomain or `?tenant=`) only PREFILLS it — it is never required
 * and never forced into the URL.
 */

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  // Revealed only after the auth-service requests a TOTP step-up.
  totpCode: z.string().optional(),
  // Optional in every case. See the component docstring.
  tenantSlug: z.string().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** One entry of the chooser — a place the submitted password actually verified. */
interface TenantChoice {
  slug: string;
  name: string;
}

interface LoginFormProps {
  /** Resolved from the subdomain / `?tenant=`; null when neither yielded a slug. A HINT, not a gate. */
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
  /** Non-empty only after a 409 TENANT_SELECTION_REQUIRED. */
  const [choices, setChoices] = useState<TenantChoice[]>([]);
  /** The advanced "I know my restaurant identifier" disclosure. Never shown by default. */
  const [showTenantField, setShowTenantField] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: createZodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      totpCode: "",
      // Prefilled from the subdomain / `?tenant=` so the hint is honoured without being imposed.
      // The user can clear it; nothing puts it back. That is the whole difference between a hint
      // and the forced redirect this plan removed from proxy.ts.
      tenantSlug: tenantSlug ?? "",
    },
  });

  /**
   * Where a successful login lands.
   *
   * Read from the session's `tokenType`, NOT from which form the user used — there is only one form
   * now, and the server is the only thing that knows whether the credential turned out to be a
   * platform one. A `returnPath` (from `?next=`) only applies to tenant sessions: it is a tenant
   * app path by construction, and sending a SuperAdmin to it would land them somewhere their
   * tenant-less token cannot authorise.
   */
  function destinationFor(session: Session): string {
    if (session.tokenType === "platform") {
      return "/platform/dashboard";
    }
    return sanitizeReturnPath(returnPath) ?? "/app/dashboard";
  }

  function submit(values: LoginFormValues, tenantOverride?: string) {
    setFormError(null);

    const slug = (tenantOverride ?? values.tenantSlug ?? "").trim();
    const totpCode = values.totpCode?.trim();

    login.mutate(
      {
        email: values.email,
        password: values.password,
        // Omitted entirely when blank — the email-first path. An empty string would be a different
        // request shape for the same intent, and auth-service normalises it anyway, but not sending
        // it at all is what makes "no tenant" the obvious default in a network log.
        ...(slug ? { tenantSlug: slug } : {}),
        ...(totpCode ? { totpCode } : {}),
      },
      {
        onSuccess: (session) => {
          router.push(destinationFor(session));
        },
        // `error` is typed as the live `ApiError` via the useLogin mutation —
        // we never import the api-client class directly (FE-08 boundary).
        onError: (error) => {
          if (error.isTotpRequired()) {
            // FD-2 O→P→Q→R: reveal the TOTP field, KEEP email/password, resubmit. The password is
            // still in form state and is re-sent with the code — losing it here would make every
            // step-up account retype their password, which is the failure this branch exists to
            // avoid.
            setTotpRequired(true);
            setFormError(null);
            window.setTimeout(() => form.setFocus("totpCode"), 0);
            return;
          }

          if (error.isTenantSelectionRequired()) {
            // The credential verified in more than one place. Every listed option is somewhere the
            // password ACTUALLY matched (auth-service builds the list after the comparison), so
            // showing them reveals nothing the user has not proven. Picking one resubmits the same
            // credential with that slug — two requests total, well inside the 2/s rate limit, and
            // no speculative logins.
            const options = error.fieldErrors.map((f) => ({ slug: f.field, name: f.issue }));
            setChoices(options);
            setFormError(null);
            return;
          }

          if (error.isPasswordChangeRequired()) {
            // 403 — the password was CORRECT and must now be changed. Re-prompting for it (the
            // natural response to a 401) would loop forever, which is why auth-service uses 403.
            const changeToken = error.fieldErrors.find((f) => f.field === "changeToken")?.issue;
            if (changeToken) {
              router.push(
                `/login/change-password?token=${encodeURIComponent(changeToken)}` +
                  `&email=${encodeURIComponent(values.email)}` +
                  (slug ? `&tenant=${encodeURIComponent(slug)}` : ""),
              );
              return;
            }
            setFormError("Your password must be changed before you can sign in.");
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
            // 401 — generic by design. It is the SAME message for an unknown address, a wrong
            // password, a suspended tenant and a deactivated account, because auth-service returns
            // the same status and the same body for all of them. Saying anything more specific here
            // would manufacture, in the client, the account-enumeration oracle the server carefully
            // does not have.
            setFormError("Invalid email or password.");
            return;
          }

          setFormError(error.message || "Something went wrong. Please try again.");
        },
      },
    );
  }

  function onSubmit(values: LoginFormValues) {
    submit(values);
  }

  function chooseTenant(slug: string) {
    setChoices([]);
    submit(form.getValues(), slug);
  }

  const restaurantLabel = tenantBrandName ?? tenantSlug;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {restaurantLabel ? `Sign in to ${restaurantLabel}` : "Sign in to RestaurantOS"}
        </CardTitle>
        <CardDescription>Enter your email and password to continue</CardDescription>
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
            That action needs a fresh authenticator code. Sign in again to continue — you&apos;ll be
            asked for your code, then taken back to where you were.
          </p>
        ) : null}

        {formError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        {choices.length > 0 ? (
          <div className="grid gap-3" data-testid="tenant-chooser">
            <div>
              <h2 className="text-base font-medium">Where would you like to sign in?</h2>
              <p className="text-sm text-muted-foreground">
                This email is used in more than one place.
              </p>
            </div>
            {choices.map((choice) => (
              <Button
                key={choice.slug}
                type="button"
                variant="outline"
                className="justify-start"
                disabled={login.isPending}
                data-testid={`tenant-choice-${choice.slug}`}
                onClick={() => chooseTenant(choice.slug)}
              >
                {choice.slug === PLATFORM_CHOICE ? "🛠 " : ""}
                {choice.name}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setChoices([])}
              disabled={login.isPending}
            >
              Back
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
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
                        autoFocus
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
                          data-testid="totp-code"
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

              {/* The restaurant field is an ESCAPE HATCH, not a step. It is shown when a hint
                  already filled it (so the user can see and clear what the URL chose for them),
                  or on request. Nothing in the normal path needs it. */}
              {showTenantField || (tenantSlug && form.getValues("tenantSlug")) ? (
                <FormField
                  control={form.control}
                  name="tenantSlug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Restaurant identifier (optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="your-restaurant"
                          autoComplete="organization"
                          data-testid="tenant-slug"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-sm text-muted-foreground">
                        Only needed if you have been asked for it. Leave blank and we&apos;ll find
                        your account.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                /* The label must NOT begin with "Sign in". It did, and that made
                   `getByRole("button", {name: "Sign in"})` — which `e2e/fixtures/auth.fixture.ts`
                   uses for every persona login in the suite — ambiguous, breaking journeys that
                   have nothing to do with this control. Caught by the browser run, not by review. */
                <button
                  type="button"
                  className="justify-self-start text-sm text-muted-foreground underline underline-offset-4"
                  data-testid="show-tenant-field"
                  onClick={() => setShowTenantField(true)}
                >
                  Use a restaurant identifier instead
                </button>
              )}

              <Button type="submit" disabled={login.isPending} className="w-full">
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

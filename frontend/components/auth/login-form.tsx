"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { useLogin } from "@/lib/hooks/auth/use-login";
import { STEP_UP_LOGIN_REASON, sanitizeReturnPath } from "@/lib/auth/step-up";
import { PLATFORM_CHOICE, type Session } from "@/lib/models/auth.model";
import { GlassPanel } from "@/components/ui/surface/glass-panel";
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
import { TotpEnrollment } from "@/components/auth/totp-enrollment";
import { ForcedPasswordChangeForm } from "@/components/auth/forced-password-change-form";

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

/** SSR-safe "has React taken over?" — see the submit button for why this form needs to know. */
const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function LoginForm({ tenantSlug, tenantBrandName, reason, returnPath }: LoginFormProps) {
  const router = useRouter();
  const login = useLogin();
  const hydrated = useSyncExternalStore(subscribeNothing, onClient, onServer);

  const [totpRequired, setTotpRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Non-empty only after a 409 TENANT_SELECTION_REQUIRED. */
  const [choices, setChoices] = useState<TenantChoice[]>([]);
  /**
   * Non-null only after a 401 TOTP_ENROLLMENT_REQUIRED (GA-008).
   *
   * Holds the live password, which is why enrolment renders inside this component rather than on
   * its own route: `/2fa/bootstrap` re-authenticates on every call, and a separate page could only
   * receive the credential through a URL, storage or a store — each of them a worse home for it
   * than the form state it is already in. Leaving the page discards it, which is correct.
   */
  const [enrolling, setEnrolling] = useState<{
    email: string;
    password: string;
    tenantSlug: string;
  } | null>(null);
  /**
   * Non-null only after a 403 PASSWORD_CHANGE_REQUIRED (D-17, F12).
   *
   * Holds the single-use change token the refusal minted, in memory, for exactly the reason the
   * enrolment state above holds the password: the alternative was `router.push` to
   * `/login/change-password?token=…&email=…`, which wrote a live credential and the user's address
   * into browser history, into the `Referer` of the next request, and into every proxy log between
   * the browser and the gateway. The forced-change form renders here instead, so the address bar
   * never moves off `/login` and nothing is written down anywhere.
   *
   * Leaving the page discards it, which is correct — a change token is only ever minted for
   * someone who has just supplied the correct password, so another one costs one sign-in.
   */
  const [changing, setChanging] = useState<{
    changeToken: string;
    email: string;
    /** The password that just verified; prefilled into the form's "current password". */
    currentPassword: string;
  } | null>(null);
  /**
   * True from the instant a forced change succeeds until the sign-in it triggers resolves (F19).
   *
   * The walkthrough found a new hire finishing the forced change and being handed an empty password
   * box: "After setting their password they are bounced to `/login` and must type the password they
   * set ten seconds earlier." They had typed it twice already, and this component was holding it.
   *
   * So the change now hands the password back and this component signs in with it, through the very
   * same `submit` every other login uses. That routing is the point, not a convenience: the TOTP
   * step-up gate lives in `AuthServiceImpl.loginToTenant`, deliberately AFTER the forced-change
   * gate, and nowhere else. Making `/change-password/forced` mint a session instead would hand a
   * token to an `rbac.manage` / `finance.period.close` / `hr.payroll.approve` holder without ever
   * asking for a second factor. Re-entering the login keeps every downstream branch — TOTP
   * required, TOTP enrolment required, tenant selection, lockout — exactly as it already is.
   *
   * This flag exists so the interval is a state the user can see. Without it the credentials form
   * flashes back with a filled password box, which is the very screen the finding is about.
   */
  const [finishing, setFinishing] = useState(false);
  /** A non-error notice, e.g. after the forced change succeeded. */
  const [notice, setNotice] = useState<string | null>(null);
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

  /**
   * @param opts.afterPasswordChange this submit is the automatic sign-in that follows a forced
   *        password change (F19). Two things depend on it, and both are about a user who cannot go
   *        back: the status line saying the password WAS saved must survive, and a failure must be
   *        worded in terms of what actually happened. Without either, a refusal reads as "the change
   *        did not work" and sends the user back to a one-time password that no longer exists.
   */
  function submit(
    values: LoginFormValues,
    tenantOverride?: string,
    opts?: { afterPasswordChange?: boolean },
  ) {
    setFormError(null);
    if (!opts?.afterPasswordChange) {
      setNotice(null);
    }

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
          // Whatever this turns out to be, the automatic sign-in that follows a forced change is
          // over: from here the user answers a challenge or a failure themselves, and every branch
          // below renders something they have to act on. Clearing it in one place rather than in
          // each branch is what stops a future branch from stranding them on "Signing you in…".
          setFinishing(false);

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
              // F12: the change token stays in memory and the URL does not move. It used to be
              // pushed to `/login/change-password?token=…&email=…`, which put a live single-use
              // credential and the user's email address in browser history, in the Referer header
              // of the next request, and in every proxy access log on the way to the gateway. The
              // forced-change form renders below instead. Nothing else about the flow changes: the
              // same token goes to the same endpoint with the same current password.
              setTotpRequired(false);
              setFormError(null);
              setNotice(null);
              setChanging({
                changeToken,
                email: values.email,
                currentPassword: values.password,
              });
              return;
            }
            setFormError("Your password must be changed before you can sign in.");
            return;
          }

          if (error.isTotpEnrollmentRequired()) {
            // GA-008. This branch used to render:
            //
            //   "Ask an administrator to complete enrolment before signing in."
            //
            // For the account that meets this refusal first — a newly provisioned OWNER — there is
            // no administrator to ask. They are the only account on the tenant, and the product
            // had just told them to seek help from someone who does not exist. A brand-new
            // restaurant could not get in at all.
            //
            // Enrolment happens here instead. `/2fa/bootstrap` needs a tenant slug, which an
            // email-first login never gave the browser; auth-service now returns the one it
            // resolved in the refusal's `details` (safe: the refusal is thrown only after the
            // password verified). Falling back to the typed slug covers the advanced path where
            // the user supplied one themselves.
            const resolvedSlug =
              error.fieldErrors.find((f) => f.field === "tenantSlug")?.issue || slug;

            if (!resolvedSlug) {
              // Older auth-service that predates the detail. Say what is true and what to do,
              // rather than pointing at an administrator who may not exist.
              setTotpRequired(false);
              setFormError(
                "This account needs two-factor authentication set up before it can sign in. " +
                  'Use "Use a restaurant identifier instead" to name your restaurant, then try again.',
              );
              return;
            }

            setTotpRequired(false);
            setFormError(null);
            setEnrolling({
              email: values.email,
              password: values.password,
              tenantSlug: resolvedSlug,
            });
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
            //
            // The one exception discloses nothing: after a forced change we KNOW whose account it
            // is and that the password was accepted a moment ago, so "invalid email or password"
            // would be the client inventing a fact. Naming the real situation costs no secret.
            setFormError(
              opts?.afterPasswordChange
                ? "Your password was changed, but signing in with it was refused. " +
                    "Press Sign in to try again."
                : "Invalid email or password.",
            );
            return;
          }

          // The unrecognised case — a 5xx, a dropped connection, a gateway that is not there.
          // `error.message` for those is whatever the transport produced ("Request failed with
          // status code 500"), which DESIGN-BRIEF §27 forbids showing. It is tolerable on an
          // ordinary sign-in, where the user knows nothing has changed and can simply try again;
          // it is not tolerable here, where the user has just changed their password, cannot go
          // back to the one they were given, and needs to be told plainly that the change stuck.
          setFormError(
            opts?.afterPasswordChange
              ? "Your password was changed, but we could not sign you in just now. " +
                  "Press Sign in to try again."
              : error.message || "Something went wrong. Please try again.",
          );
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

  /**
   * The one non-error line above the form, resolved here rather than as three sibling paragraphs.
   *
   * `notice` wins because it describes something that just happened in this tab (the password
   * change), whereas the two `reason` hints describe how the user arrived; if both are true, the
   * newer fact is the one worth saying. The step-up wording stays distinct from `session_expired`
   * on purpose: nothing expired that the user did wrong, and telling them their session ended when
   * it did not invites a support call.
   */
  const statusNote = finishing
    ? // The "Signing you in" panel says this in its own words; a second line saying it again is
      // noise on the one screen that must be unambiguous. It comes back the moment the sign-in
      // fails, because then it is the only thing telling the user their password was saved.
      null
    : notice
      ? notice
      : reason === "session_expired"
        ? "Your session expired. Please sign in again."
        : reason === STEP_UP_LOGIN_REASON
          ? "That action needs a fresh authenticator code. Sign in again to continue — you’ll be " +
            "asked for your code, then taken back to where you were."
          : null;

  return (
    /*
     * Phase 34: glass + depth-3 + an entrance. ONLY the surface around the form changed.
     *
     * The field names, the submit path, the error wording, the step-up prompt behaviour and
     * every redirect target below are untouched, and `__tests__/auth/login-form.test.tsx`
     * asserts it. This is the one screen where a cosmetic change that breaks a flow locks
     * every user out of the product, and it is reachable without a session — so nobody is
     * watching it in a staging tenant either.
     *
     * The glass sits over `--surface-2`, which the (auth) layout declares and 34-02's manifest
     * enumerates, so its contrast is measured (17.73:1 composited, 18.01:1 with the filter
     * unavailable) rather than inherited from whatever the page happens to paint.
     *
     * `.vdl-enter` carries no resting style — strip it and the card is exactly where it is now,
     * at full opacity. Under reduced motion it resolves `animation: none` and the card simply
     * appears.
     */
    <GlassPanel depth={3} className="vdl-enter overflow-hidden p-0">
      {/* A brand band, so the first screen a customer sees is not an unstyled white box. */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-linear-to-r from-primary-400 via-primary-600 to-primary-800"
      />
      <div className="flex flex-col gap-4 p-6">
        {/* The heading follows the STEP, not the route — the forced change and TOTP enrolment both
          happen here now, and a panel titled "Enter your email and password to continue" above a
          new-password form is a screen that lies about what it is asking for. */}
        <div className="grid gap-1">
          <h1 className="font-heading text-lg leading-snug font-medium">
            {changing
              ? "Choose a new password"
              : finishing
                ? "Signing you in"
                : restaurantLabel
                  ? `Sign in to ${restaurantLabel}`
                  : "Sign in to RestaurantOS"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {changing
              ? `${changing.email} must set its own password before signing in.`
              : finishing
                ? "Your new password is saved."
                : "Enter your email and password to continue"}
          </p>
        </div>
        <div>
          {/* ONE status line, three sources. They are mutually exclusive in practice and were three
            separate paragraphs carrying identical classes, which is three places to drift and three
            entries against the type-scale gate for one visual element. */}
          {statusNote ? (
            <p className="mb-4 text-sm text-muted-foreground" role="status">
              {statusNote}
            </p>
          ) : null}

          {formError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {changing ? (
            /*
             * F12: the forced password change happens HERE, not at `/login/change-password?token=…`.
             * The single-use token is in `changing`, in memory, and never reaches the address bar.
             */
            <ForcedPasswordChangeForm
              changeToken={changing.changeToken}
              currentPassword={changing.currentPassword}
              onCancel={() => {
                setChanging(null);
                form.setValue("password", "");
              }}
              onChanged={(newPassword) => {
                // F19. The change endpoint issues no token and sets no refresh cookie (13-08), so
                // a sign-in still has to happen — but the user has just typed the password twice
                // and this component is holding it, so THIS component performs the sign-in.
                //
                // It goes through the ordinary `submit`, not a special path, because the login
                // endpoint is where the TOTP step-up gate lives and where every other refusal is
                // already handled. A hire whose role needs a second factor is challenged for it
                // here, which is exactly what would have happened had they retyped the password.
                const emailUsed = changing.email;
                const slugUsed = form.getValues("tenantSlug") ?? "";
                const values: LoginFormValues = {
                  email: emailUsed,
                  password: newPassword,
                  totpCode: "",
                  tenantSlug: slugUsed,
                };
                setChanging(null);
                setFinishing(true);
                // The form is kept in step with what is being submitted, so that if the sign-in is
                // refused the user is looking at a form that already holds their real credential
                // rather than a blank one.
                form.reset(values);
                toast.success("Password changed.");
                setNotice("Your new password is saved.");
                submit(values, undefined, { afterPasswordChange: true });
              }}
            />
          ) : finishing ? (
            /*
             * F19: the interval between "password saved" and "you are in the app", rendered.
             *
             * Nothing here is decorative. Without it the credentials form re-appears for the length
             * of one round trip with the password box filled — which is indistinguishable, in a
             * screenshot and to a person, from being asked to sign in again. That is the finding.
             *
             * It is a live region because it replaces the control the user just pressed: a screen
             * reader that was on the "Change password" button is told what happened instead of
             * being dropped into silence.
             */
            <div
              className="grid gap-2 py-4"
              data-testid="finishing-sign-in"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm text-muted-foreground">Taking you into the app…</p>
            </div>
          ) : enrolling ? (
            <TotpEnrollment
              email={enrolling.email}
              password={enrolling.password}
              tenantSlug={enrolling.tenantSlug}
              onCancel={() => setEnrolling(null)}
              onEnrolled={() => {
                // Back to the credentials form with the TOTP field already revealed: the account now
                // HAS a factor, so the next login will be challenged for a code rather than refused.
                // Enrolment is not a login and does not become one — the user signs in normally,
                // which keeps the two events, and their two audit records, distinct.
                setEnrolling(null);
                setTotpRequired(true);
                form.setValue("totpCode", "");
                window.setTimeout(() => form.setFocus("totpCode"), 0);
              }}
            />
          ) : choices.length > 0 ? (
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

                {/* Disabled until React has hydrated, and NOT for cosmetic reasons.
                  `react-hook-form`'s `handleSubmit` is what calls `preventDefault()`; before
                  hydration it is not attached, so a submit falls through to the browser's native
                  handling. This form declares no `action` and no `method`, so a native submit is a
                  GET to the current URL — which puts the typed EMAIL AND PASSWORD in the address
                  bar, in browser history, and in any access log along the way. Observed live
                  during 14b verification: `/login?email=owner%40terrace.local&password=…`.
                  There is no non-JS path worth preserving here (the whole route is `"use client"`
                  and cannot authenticate without JS), so refusing the submit until it can be
                  handled properly costs nothing and closes the leak. Mirrors ThemeToggle's
                  `useSyncExternalStore` mounted check rather than an effect, per the codebase's
                  react-hooks/set-state-in-effect rule. */}
                <Button
                  type="submit"
                  disabled={login.isPending || !hydrated}
                  className="w-full"
                  data-testid="login-submit"
                >
                  {login.isPending ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </Form>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

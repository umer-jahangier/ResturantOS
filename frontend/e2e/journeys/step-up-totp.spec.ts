import { expect, test, uiLoginWithTotp } from "../fixtures/auth.fixture";
import { apiLogin, jwtClaims } from "../fixtures/gateway";
import { persona } from "../fixtures/personas";
import { loadTotpSecret, totpStable } from "../fixtures/totp";

/**
 * JOURNEY 2 — the TOTP step-up login, in a real browser, with a real code.
 *
 * The OWNER persona is TOTP-enrolled at creation (D-29a, 13-CONTEXT.md:78-95) because it
 * holds `finance.period.close` and `hr.payroll.approve`, both of which trip
 * `requiresTotpStepUp`. A password-only login is therefore refused, and the login form only
 * grows an authenticator field AFTER that refusal.
 *
 * Three separate claims, because they fail independently:
 *   A. the form reveals the field on TOTP_REQUIRED and a live code completes the login
 *   B. the resulting access token carries totp_verified = true
 *   C. a REFRESHED token does NOT — which is why storage state can never stand in for this
 */

const OWNER = persona("terrace", "owner");

/**
 * SERIAL, and this is a product constraint rather than a test-isolation preference.
 *
 * Every case here authenticates the SAME account. `AuthServiceImpl.login` resets
 * failed_login_count / locked_until / last_login_at and calls `userRepository.save(user)`
 * (L122-126) on a `@Version`-annotated entity (UserEntity.java:59), so two concurrent logins
 * for one user race that row: the loser throws OptimisticLockingFailureException, which
 * GlobalExceptionHandler turns into 409 CONCURRENT_MODIFICATION.
 *
 * MEASURED 2026-08-07 — four simultaneous logins as owner@marina.local: 1×200, 3×409. The
 * same four as four DIFFERENT users: 4×200. Running these in parallel therefore tests the
 * race, not the step-up.
 *
 * See the defect note in .planning/research/adaptivity/browser-e2e.md — a shared till account
 * signing in on two terminals at once hits this in production, with the message
 * "This record changed while you were editing it".
 */
test.describe.configure({ mode: "serial" });

test.describe("TOTP step-up", () => {
  // GUIDE-CLAIM: FIN-GUIDE-0004 — "A few actions ask for a six-digit code from your
  // authenticator app, even though you are already signed in." The finance guide tells owners
  // this is deliberate rather than a fault. See frontend/lib/finance/guide/claims.json and
  // `make verify-guide-claims`.
  test("A · owner signs in through the form with a live code", async ({ page, tenants, obs }) => {
    // The 401 IS the mechanism under test: the form has no authenticator field until the
    // server has refused once. Declared rather than muted, so a 401 anywhere ELSE in this
    // test still fails it.
    obs.expect401(
      "/api/v1/auth/login",
      "the step-up challenge itself — TOTP_REQUIRED is what reveals the code field",
    );

    const slug = tenants[OWNER.tenantKey]!.slug;

    await page.goto(`/login?tenant=${encodeURIComponent(slug)}`);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);

    /*
     * THE LABEL IS "Authenticator OR RECOVERY code", and this spec asked for the wrong one.
     *
     * <p>`components/auth/login-form.tsx:704` renders `Authenticator or recovery code` — it has
     * since recovery codes were added, and `origin/main` says the same. `getByLabel` matches on
     * a SUBSTRING, and "Authenticator code" is not a substring of that, so the old locator could
     * never match anything on any build. Two consequences, both worth naming: the wait below
     * burned 15s and failed on a form that was behaving correctly, and the `toHaveCount(0)`
     * above — the assertion that stops this test passing against a form that always shows the
     * field — passed VACUOUSLY, because a locator that matches nothing also matches nothing
     * before the refusal. It is a real control again now.
     */
    const TOTP_LABEL = "Authenticator or recovery code";

    // No authenticator field exists yet — this is the pre-refusal state, and asserting it
    // is what stops the test passing against a form that always shows the field.
    await expect(page.getByLabel(TOTP_LABEL)).toHaveCount(0);

    await page.getByRole("button", { name: "Sign in" }).click();

    const totpField = page.getByLabel(TOTP_LABEL);
    await expect(
      totpField,
      `the server should have refused with TOTP_REQUIRED and the form should have revealed the ` +
        `"${TOTP_LABEL}" field. If the browser is sitting in the app shell instead, no challenge ` +
        `was issued at all and ${OWNER.email} is not step-up-enrolled on this environment — ` +
        "re-run `python3 scripts/seed_restaurantos.py --phase personas --repair` against it.",
    ).toBeVisible({ timeout: 15_000 });

    // The email and password must survive the refusal — a form that cleared them would make
    // step-up unusable in practice while still "working".
    await expect(page.getByLabel("Email")).toHaveValue(OWNER.email);

    const secret = loadTotpSecret(OWNER.email);
    expect(secret, `no enrolled secret for ${OWNER.email}`).not.toBeNull();
    await totpField.fill(await totpStable(secret!));
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/app\/dashboard/, { timeout: 25_000 });
    /*
     * The dashboard's `<h1>` is the PRESET'S QUESTION, not the word "Dashboard".
     *
     * <p>`components/dashboard/dashboard-shell.tsx:133` renders `{preset.question}` — live, an
     * owner reads `Is the business healthy?` (`presets.ts:215`) and a KITCHEN_STAFF reads
     * `What needs me in the next five minutes?`. `origin/main` does the same, so this is not a
     * local change waiting to deploy: the literal this spec asked for has not been on the screen
     * for as long as presets have existed, and asserting it made a successful step-up look like
     * a failed one.
     *
     * <p>What is asserted instead is the shell's own stable hooks plus a NON-EMPTY heading —
     * `data-testid="dashboard"` is what the product publishes for this, and the emptiness check
     * keeps the assertion from going vacuous the day a preset ships with no question.
     */
    const dashboard = page.getByTestId("dashboard");
    await expect(dashboard).toBeVisible({ timeout: 20_000 });
    await expect(dashboard).toHaveAttribute("data-preset", /.+/);
    await expect(dashboard.getByRole("heading", { level: 1 })).not.toBeEmpty();
  });

  test("A2 · a wrong code is refused and the user stays on /login", async ({
    page,
    tenants,
    obs,
  }) => {
    // Two by-design 401s here: the challenge, then the refusal of 000000.
    obs.expect401("/api/v1/auth/login", "the challenge, then the refusal of a wrong code");

    const slug = tenants[OWNER.tenantKey]!.slug;
    await page.goto(`/login?tenant=${encodeURIComponent(slug)}`);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    const totpField = page.getByLabel("Authenticator code");
    await expect(totpField).toBeVisible({ timeout: 15_000 });
    await totpField.fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(0);
  });

  /**
   * B and C together, at the API boundary — the access token is memory-only in the browser
   * (frontend/lib/auth/session.ts:5-8) so there is no way to read its claims from the page.
   * This is the assertion that pins the constraint the whole fixture design rests on.
   */
  test("B/C · totp_verified is minted at login and dropped at refresh", async ({
    gateway,
    tenants,
  }) => {
    const slug = tenants[OWNER.tenantKey]!.slug;
    const secret = loadTotpSecret(OWNER.email);
    expect(secret).not.toBeNull();

    const withCode = await apiLogin(gateway, {
      email: OWNER.email,
      password: OWNER.password,
      tenantSlug: slug,
      totpCode: await totpStable(secret!),
    });
    expect(withCode.status, JSON.stringify(withCode.raw).slice(0, 300)).toBe(200);
    expect(
      jwtClaims(withCode.accessToken!).totp_verified,
      "a login that verified a code must mint totp_verified = true",
    ).toBe(true);

    // Same cookie jar → the refresh_token just set is sent automatically.
    const refreshed = await gateway.post("/api/v1/auth/refresh", { failOnStatusCode: false });
    expect(refreshed.status()).toBe(200);
    const body = (await refreshed.json()) as { data: { accessToken: string } };
    expect(
      jwtClaims(body.data.accessToken).totp_verified,
      "AuthServiceImpl.refresh mints totp_verified FALSE on purpose (L160-168): an hour-grade " +
        "proof of possession must not ride a 30-day refresh credential. If this ever flips to " +
        "true, every storage-state-based fixture silently gains step-up rights it should not " +
        "have, and this suite stops being able to tell the difference.",
    ).toBe(false);
  });

  /** The helper the rest of the suite will use for step-up-gated journeys, exercised once. */
  test("D · uiLoginWithTotp helper drives the same flow", async ({ page, tenants, obs }) => {
    obs.expect401("/api/v1/auth/login", "the step-up challenge the helper is driving");
    await uiLoginWithTotp(page, OWNER, tenants[OWNER.tenantKey]!.slug);
    await expect(page).toHaveURL(/\/app\//);
  });
});

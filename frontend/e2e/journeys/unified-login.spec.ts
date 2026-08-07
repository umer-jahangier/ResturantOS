import { expect, test } from "../fixtures/auth.fixture";
import { loadTotpSecret, TOTP_SECRET_DIR, totpStable } from "../fixtures/totp";

/**
 * JOURNEY — one login form, email-first, for everyone (16a-01).
 *
 * <h3>What was broken</h3>
 *
 * Three things, and they compounded:
 *   1. `proxy.ts` redirected every bare `/login` to `/login?tenant=<NEXT_PUBLIC_DEFAULT_TENANT_SLUG>`,
 *      and that value was a stale slug (`test`) that no longer names a tenant;
 *   2. the form REQUIRED a restaurant slug and refused to submit without one;
 *   3. the SuperAdmin — who belongs to no tenant and whose credential is verified by a different
 *      service — had **no login route in the UI at all**. Plan 13-05 built the endpoint; nothing
 *      ever built the screen. The SuperAdmin could not sign in through a browser.
 *
 * <h3>Why these run against the real stack and not a mock</h3>
 *
 * Every claim here is about something no unit test can reach: that the browser is not redirected,
 * that ONE form serves two different backends, that the server-side resolution picks the right one,
 * and that two very different wrong inputs are indistinguishable to the person typing them.
 *
 * <h3>Accounts</h3>
 *
 * `floating-terrace` (scripts/CREDENTIALS.md) rather than the saffron/zaitoon/marina personas, so
 * that the exact journeys reported as broken are the exact journeys asserted here.
 */

/**
 * SERIAL. Two independent reasons, both measured rather than assumed:
 *
 *   · the gateway rate-limits /api/v1/auth/** at replenishRate=2/s keyed on source IP, so every
 *     worker on this machine spends one shared bucket (fixtures/gateway.ts documents the same);
 *   · `AuthServiceImpl.login` writes to a @Version-annotated `users` row on success, so two
 *     concurrent logins as the same account race it and the loser gets 409.
 */
test.describe.configure({ mode: "serial" });

const SUPERADMIN = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };
const OWNER = { email: "owner@terrace.local", password: "Terrace#Owner1" };

/** Keeps the suite inside the shared 2/s auth bucket; a 429 would be a harness failure, not a product one. */
async function pace(): Promise<void> {
  await new Promise((r) => setTimeout(r, 700));
}

test.describe("unified email-first login", () => {
  test("A · /login is not rewritten to a default tenant, and asks for no restaurant", async ({
    page,
  }) => {
    await page.goto("/login");

    // The defect verbatim: opening the app landed on /login?tenant=test. Asserting the URL is the
    // only way to catch a redirect — every other assertion here would pass just as well on the
    // redirected page.
    expect(new URL(page.url()).searchParams.get("tenant")).toBeNull();
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    // No restaurant field, and specifically NOT merely "not required" — absent. A field that is
    // present but optional is still a question the user has to decide not to answer.
    await expect(page.getByTestId("tenant-slug")).toBeHidden();
  });

  test("B · the SuperAdmin signs in from that same form and reaches the platform console", async ({
    page,
  }) => {
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(SUPERADMIN.email);
    await page.getByLabel("Password").fill(SUPERADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // /platform/**, not /app/**. The routing decision is made from the response's `tokenType`,
    // which is the only thing that knows this credential turned out to be a control-plane one.
    await page.waitForURL(/\/platform\//, { timeout: 25_000 });
    await expect(page.getByRole("heading", { name: /Platform Dashboard/i })).toBeVisible();
  });

  test("C · a tenant manager signs in with no tenant and reaches the tenant app", async ({
    page,
  }) => {
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/app\//, { timeout: 25_000 });
  });

  test("D · a step-up account is challenged for TOTP and completes, without retyping its password", async ({
    page,
    obs,
  }) => {
    // The 401 IS the behaviour under test — it is how the server asks for a second factor, and the
    // form only grows the code field in response to it. Declared rather than the guard being
    // loosened, so an UNEXPECTED 401 on this page still fails the test.
    obs.expect401(
      /\/api\/v1\/auth\/login$/,
      "TOTP_REQUIRED — the step-up challenge this test exists to exercise",
    );

    const secret = loadTotpSecret(OWNER.email);
    expect(
      secret,
      `${OWNER.email} is TOTP-enrolled but no secret exists in ${TOTP_SECRET_DIR}. auth-service ` +
        "mints it at enrolment and it cannot be re-derived — re-run " +
        "`python3 scripts/seed_restaurantos.py --phase personas --repair`.",
    ).not.toBeNull();

    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The field appears only AFTER the server refuses with TOTP_REQUIRED — the product's shape,
    // not the test's. Asking for a code up front would mean asking every user for one.
    const totpField = page.getByTestId("totp-code");
    await expect(totpField).toBeVisible({ timeout: 25_000 });

    // The password field must still hold the password. Losing it here is the regression this
    // assertion exists for: the user would have to retype it to answer a challenge they did not
    // ask for, on a form that appears to have forgotten what they just did.
    await expect(page.getByLabel("Password")).toHaveValue(OWNER.password);

    await totpField.fill(await totpStable(secret!));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//, { timeout: 25_000 });
  });

  test("E · an unknown address and a wrong password are indistinguishable", async ({
    page,
    obs,
  }) => {
    // Both refusals are the point of the test; an undeclared 401 anywhere else still fails.
    obs.expect401(
      /\/api\/v1\/auth\/login$/,
      "the two refusals this test compares — asserting they are identical is the whole test",
    );

    // THE GUARDRAIL. A unified login is the easiest place in a multi-tenant product to build an
    // account-enumeration oracle by accident: resolve first, then ask for the password, and the
    // form cheerfully reports which restaurant groups a person works for to anyone who types their
    // address. The server refuses identically; this asserts the SCREEN does too.
    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill("no-such-person@nowhere.invalid");
    await page.getByLabel("Password").fill("Whatever#2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    const unknownText = await page.getByRole("alert").first().textContent({ timeout: 25_000 });

    await pace();
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill("DefinitelyNotIt#2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    const wrongPasswordText = await page
      .getByRole("alert")
      .first()
      .textContent({ timeout: 25_000 });

    expect(wrongPasswordText).toBe(unknownText);
    // Neither may name a tenant, a restaurant, or the fact that the address was recognised.
    expect(unknownText).not.toMatch(/terrace|restaurant|tenant|not found|unknown/i);
    // Both stay on /login — a redirect that differed would be a channel of its own.
    await expect(page).toHaveURL(/\/login/);
  });
});

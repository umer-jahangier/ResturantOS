import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { GATEWAY_URL } from "../fixtures/gateway";

/**
 * JOURNEY — the SuperAdmin platform console (19c).
 *
 * <h3>What was broken</h3>
 *
 * Two things, and they are opposites:
 *
 *   1. **GA-010** — `app/(platform)` was 23 lines across two files: a header, one sentence, zero
 *      anchors, zero `<nav>`, and no call to `/api/v1/platform/**` anywhere outside `e2e/`. Fourteen
 *      working endpoints with no browser path.
 *   2. **GA-002** — that non-console was nevertheless served to ANYONE with a session.
 *      `proxy.ts` gates `/platform/**` on the `has_session` cookie, which is non-HttpOnly,
 *      forgeable, and set for every logged-in user of every tenant. A KITCHEN_STAFF account
 *      rendered the SuperAdmin shell.
 *
 * <h3>Why every assertion here needs a real browser and a real stack</h3>
 *
 * Each claim is about a boundary no unit test can reach: that the authorization decision is made
 * from a verified token rather than a cookie; that a module toggled in the console changes what
 * the gateway does to a DIFFERENT tenant's user on their next request; and that the usage screen
 * declines to print a number nobody measured. The last one in particular can only be checked by
 * looking at the rendered text — a component test would assert against the same mock that made the
 * mistake.
 */

/**
 * SERIAL. The same two reasons as `unified-login.spec.ts`, both measured rather than assumed:
 * the gateway rate-limits `/api/v1/auth/**` at 2/s keyed on source IP so every worker shares one
 * bucket, and `AuthServiceImpl.login` writes a `@Version`-annotated row so two concurrent logins as
 * one account race into 409. Test D also mutates a tenant's flags and restores them, which must not
 * interleave with anything reading them.
 */
test.describe.configure({ mode: "serial" });

const SUPERADMIN = { email: "superadmin@softxlogic.com", password: "Test@123!" };

/** Keeps this spec inside the shared 2/s auth bucket; a 429 is a harness failure, not a product one. */
async function pace(): Promise<void> {
  await new Promise((r) => setTimeout(r, 700));
}

/** Sign in through the real form, with NO tenant slug — the 16a-01 email-first path. */
async function signInAsSuperAdmin(page: import("@playwright/test").Page): Promise<void> {
  await pace();
  await page.goto("/login");
  await page.getByLabel("Email").fill(SUPERADMIN.email);
  await page.getByLabel("Password").fill(SUPERADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/platform\//, { timeout: 25_000 });
}

/**
 * Reach a tenant's detail screen the way a SuperAdmin actually can: by clicking.
 *
 * <b>`page.goto` would fail, and not because of anything on this page.</b> A platform session
 * cannot survive a full page load — see test F, which pins the cause. The access token is
 * memory-only by design, and the platform login issues an EMPTY `refresh_token`, so any navigation
 * that reloads the document drops the session and `SessionProvider` sends the browser to
 * `/login?reason=session_expired`. Client-side navigation keeps the token in memory, which is why
 * every screen here is reached by clicking through the list rather than by URL.
 */
async function openTenant(page: import("@playwright/test").Page, brandName: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Tenants" })
    .click();
  await page.waitForURL(/\/platform\/tenants$/);
  await page.getByRole("link", { name: brandName, exact: true }).click();
  await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("tenant-detail-name")).toHaveText(brandName);
}

test.describe("SuperAdmin platform console", () => {
  test("A · the console has navigation and lists real tenants", async ({ page }) => {
    await signInAsSuperAdmin(page);

    // The chrome UI-SPEC §7.5 requires, so a platform-wide action is never mistaken for a
    // tenant-scoped one. Both were absent: the old layout rendered a bare <header>.
    await expect(page.getByTestId("platform-chip")).toHaveText(/platform/i);
    await expect(page.getByTestId("platform-warning-rule")).toBeVisible();

    // GA-010's headline measurement was "0 anchors, 0 <nav>". This is that number, inverted.
    const nav = page.getByRole("navigation", { name: "Platform" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(2);

    await nav.getByRole("link", { name: "Tenants" }).click();
    await page.waitForURL(/\/platform\/tenants$/);

    // GA-053: this route was the product's only unguarded dead link — a real 404 page.
    await expect(page).not.toHaveTitle(/404/);
    await expect(page.getByTestId("tenant-table")).toBeVisible();

    // Real rows, from the live API. floating-terrace and the control tenant both exist.
    await expect(page.getByTestId("tenant-row-floating-terrace")).toBeVisible();
    await expect(page.getByTestId("tenant-row-zaitoon-kitchen")).toBeVisible();
  });

  test("B · a tenant persona is REFUSED at /platform/**", async ({ as, obs }) => {
    // KITCHEN_STAFF: the exact persona the audit reported rendering the SuperAdmin shell.
    const kitchen = await as(persona("saffron", "kitchen"));

    // Any /api/v1/platform call this page makes is expected to be refused. Declared so the
    // console guard reports it rather than failing the test for the thing being asserted.
    obs.expect403(/\/api\/v1\/platform\//, "a tenant principal must be refused the platform API");

    await kitchen.goto("/platform/dashboard");

    // The refusal, and specifically NOT a redirect to /login: this account is correctly
    // authenticated. It is authorization that must fail, and the message has to say so.
    await expect(kitchen.getByTestId("platform-access-denied")).toBeVisible({ timeout: 20_000 });

    // The console itself must not be reachable behind the message. Before 19c all three of these
    // rendered for this persona.
    await expect(kitchen.getByTestId("platform-chip")).toBeHidden();
    await expect(kitchen.getByRole("navigation", { name: "Platform" })).toBeHidden();
    await expect(kitchen.getByTestId("tenant-table")).toBeHidden();

    // And the tenant list is not reachable by typing its URL either — the guard is on the route
    // group, not on one page.
    await kitchen.goto("/platform/tenants");
    await expect(kitchen.getByTestId("platform-access-denied")).toBeVisible({ timeout: 20_000 });
    await expect(kitchen.getByTestId("tenant-table")).toBeHidden();
  });

  test("C · an override is visibly distinguished from a tier default", async ({ page }) => {
    await signInAsSuperAdmin(page);

    // Zaitoon Kitchen: GROWTH, with FEATURE_CRM deliberately overridden OFF by the seed. CRM is on
    // in EVERY tier by default, so "off" here can only have come from a decision.
    await openTenant(page, "Zaitoon Kitchen");

    const crm = page.getByTestId("feature-row-FEATURE_CRM");
    await expect(crm).toBeVisible({ timeout: 20_000 });

    // The whole point. Before 19c the API returned `"FEATURE_CRM": false` and
    // `"FEATURE_ANALYTICS": false` identically, so no UI could have drawn this distinction.
    await expect(crm).toHaveAttribute("data-source", "OVERRIDE_REVOKE");
    await expect(crm).toContainText("Revoked despite tier");
    await expect(crm).toContainText(/Tier default: on/);

    // A code that is off for the ordinary reason, in the same table, as the control. If both rows
    // read the same the screen has told the operator nothing.
    const white = page.getByTestId("feature-row-FEATURE_WHITE_LABEL_DOMAIN");
    await expect(white).toHaveAttribute("data-source", "TIER_DEFAULT");
    await expect(white).toContainText("Not in tier");

    // The revert control exists only on the overridden row — UI-SPEC §7.5 asks for exactly that.
    await expect(crm.getByTestId("feature-revert-FEATURE_CRM")).toBeVisible();
    await expect(white.getByTestId("feature-revert-FEATURE_WHITE_LABEL_DOMAIN")).toBeHidden();
  });

  test("D · toggling a module changes what that tenant's users can reach", async ({
    page,
    gateway,
    token,
  }) => {
    const zaitoonManager = persona("zaitoon", "manager");
    const zaitoonId = await tenantIdBySlug(gateway, page, "zaitoon-kitchen");

    // BEFORE: the gateway refuses CRM for this tenant's user. Establishing this first means a
    // green result cannot come from CRM having been enabled all along.
    const before = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${await token(zaitoonManager)}` },
      failOnStatusCode: false,
    });
    expect(before.status(), "the seeded state is FEATURE_CRM off for zaitoon").toBe(403);
    expect((await before.json()).error.code).toBe("FEATURE_DISABLED");

    try {
      await signInAsSuperAdmin(page);
      await openTenant(page, "Zaitoon Kitchen");

      await page.getByTestId("feature-enable-FEATURE_CRM").click();

      // The row flips to a grant: CRM is now on, above nothing — GROWTH includes it — so this is
      // an override that agrees with the tier and is still pinned.
      await expect(page.getByTestId("feature-row-FEATURE_CRM")).toHaveAttribute(
        "data-enabled",
        "true",
        { timeout: 20_000 },
      );

      // AFTER: the same user, the same request, a different answer. Asserted at the GATEWAY, not
      // in the UI — the nav fails open on a flag-fetch error, so a UI-only check could pass with
      // the whole feature system broken. `not.toBe(403)` rather than `toBe(200)` because
      // crm-service may legitimately be down and the gateway would then return its 503 fallback;
      // what must never happen for an entitled tenant is FEATURE_DISABLED.
      await expect
        .poll(
          async () => {
            const res = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
              headers: { Authorization: `Bearer ${await token(zaitoonManager)}` },
              failOnStatusCode: false,
            });
            return res.status();
          },
          { timeout: 20_000, message: "the gateway must stop refusing CRM once it is enabled" },
        )
        .not.toBe(403);
    } finally {
      // Restore the seeded divergence EXACTLY: `is_enabled = false, is_override = true`.
      //
      // Deliberately NOT the console's Revert control, which clears the marker and returns the row
      // to the GROWTH default of ON — the opposite of the seeded state. Three other specs
      // (tenant-feature-gating, persona-access-matrix, role-visibility-matrix) assert CRM is off
      // for zaitoon, and a journey that leaves the fixture altered breaks them for reasons that
      // look nothing like its own name.
      const sa = await platformToken(gateway);
      await gateway.patch(`/api/v1/platform/tenants/${zaitoonId}/features/FEATURE_CRM`, {
        headers: { Authorization: `Bearer ${sa}`, "Content-Type": "application/json" },
        data: { enabled: false },
        failOnStatusCode: false,
      });
    }

    // And prove the restore actually took, rather than trusting the finally block.
    const after = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${await token(zaitoonManager)}` },
      failOnStatusCode: false,
    });
    expect(
      after.status(),
      "the seeded state must be restored for the specs that depend on it",
    ).toBe(403);
  });

  test("E · usage reports what is measured and refuses to invent the rest", async ({ page }) => {
    await signInAsSuperAdmin(page);
    await openTenant(page, "Floating Terrace");

    const meters = page.getByTestId("usage-meters");
    await expect(meters).toBeVisible({ timeout: 20_000 });

    // The one dimension with a real count — the same user-service call the tier-downgrade check
    // trusts. It shows a number and a bar.
    const branches = page.getByTestId("usage-meter-branches");
    await expect(branches).toHaveAttribute("data-metered", "true");
    await expect(branches).toHaveAttribute("data-unavailable", "false");
    await expect(branches.getByRole("meter")).toBeVisible();

    // The three nobody records. `usage_records` has 0 rows and 0 producers; the NLQ counter has 0
    // keys. Each says so IN WORDS and names the reason.
    for (const resource of ["users", "storage_gb", "nlq_queries"]) {
      const meter = page.getByTestId(`usage-meter-${resource}`);
      await expect(meter).toHaveAttribute("data-metered", "false");
      await expect(meter).toContainText("Not metered");

      // The assertion that matters most, and the reason this test exists: no fabricated
      // numerator. "0 / 500 users" for a tenant with real staff is not an incomplete feature —
      // it is a false statement on a screen that informs capacity and billing decisions.
      await expect(meter).not.toContainText(/\b0\s*\/\s*\d/);
      await expect(meter.getByRole("meter")).toBeHidden();
    }

    // The entitlement half IS real and IS shown — those four ceilings had been returned by the API
    // since Phase 3 and read by nothing (GA-083).
    await expect(page.getByTestId("usage-meter-users")).toContainText(/Limit 500 users/);
  });

  /**
   * F · PINNED DEFECT — a SuperAdmin cannot reload, deep-link, or open a platform page in a new tab.
   *
   * <h3>What was measured</h3>
   *
   * Found while building this console: `page.goto('/platform/tenants/{id}')` after a successful
   * SuperAdmin login lands on `/login` reading "Your session expired. Please sign in again."
   *
   * The cause is one header. `POST /api/v1/auth/login` sets an <b>empty</b> refresh cookie for a
   * platform user and a real one for a tenant user:
   *
   * <pre>
   *   platform: Set-Cookie: refresh_token=;         Path=/api/v1/auth; Max-Age=604800; HttpOnly
   *   tenant:   Set-Cookie: refresh_token=eyJhbGci… Path=/api/v1/auth; Max-Age=604800; HttpOnly
   * </pre>
   *
   * The access token is memory-only by design, so a document load has nothing to rehydrate from:
   * `SessionProvider` calls `/auth/refresh`, the empty cookie fails, and the browser is redirected.
   * 13-05 states a platform session deliberately has no refresh token ("it re-authenticates rather
   * than refreshes, so no long-lived platform credential exists to be stolen") — a defensible
   * security posture whose browser consequence was never worked through. It predates this phase and
   * is not fixable inside it: the fix belongs in auth-service or in a platform-specific rehydration
   * path, neither of which this workstream owns.
   *
   * <h3>Why this test asserts the DEFECT rather than the fix</h3>
   *
   * Following the `known-defects.ts` philosophy: name it once, pin it, and make the pin fail when
   * somebody fixes it. Asserting the correct behaviour would leave a permanently red test that gets
   * ignored; asserting the current behaviour means the day a real refresh token appears here, this
   * test goes red and tells the reader to delete it and drop `openTenant`'s click-through workaround.
   */
  test("F · PINNED DEFECT: a platform login issues no usable refresh token", async ({
    gateway,
  }) => {
    const platform = await gateway.post(`${GATEWAY_URL}/api/v1/auth/login`, {
      data: SUPERADMIN,
    });
    expect(platform.status()).toBe(200);

    const platformCookie = (platform.headersArray() ?? [])
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .find((h) => h.value.startsWith("refresh_token="));

    expect(platformCookie, "the platform login still sets a refresh_token cookie").toBeTruthy();
    expect(
      platformCookie!.value.startsWith("refresh_token=;"),
      "PINNED DEFECT — if this fails, a platform login now issues a REAL refresh token. That is " +
        "the fix: a SuperAdmin can reload and deep-link again. Delete this test and simplify " +
        "openTenant() to a plain page.goto.",
    ).toBe(true);
  });
});

/** A SuperAdmin bearer token for the API-level assertions and the restore. */
async function platformToken(
  gateway: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await gateway.post(`${GATEWAY_URL}/api/v1/auth/login`, {
    data: { email: SUPERADMIN.email, password: SUPERADMIN.password },
  });
  expect(res.status(), "the SuperAdmin must be able to log in with no tenant slug").toBe(200);
  const body = await res.json();
  expect(body.data.tokenType, "a platform login must mint a platform token").toBe("platform");
  expect(body.data.tenantId, "a platform user belongs to no tenant").toBeNull();
  return body.data.accessToken;
}

/**
 * Resolve a tenant id from its slug, live.
 *
 * Slugs are minted from brand names at provisioning time and ids are not stable across
 * re-provisioning, so both are resolved rather than hard-coded — the same reason the persona
 * fixture refuses to hard-code a slug.
 */
async function tenantIdBySlug(
  gateway: import("@playwright/test").APIRequestContext,
  _page: import("@playwright/test").Page,
  slug: string,
): Promise<string> {
  const res = await gateway.get(`${GATEWAY_URL}/api/v1/platform/tenants?page=0&size=200`, {
    headers: { Authorization: `Bearer ${await platformToken(gateway)}` },
  });
  expect(res.status()).toBe(200);
  const found = (await res.json()).data.find((t: { slug: string }) => t.slug === slug);
  expect(found, `no tenant with slug ${slug} — the seed may not have run`).toBeTruthy();
  return found.id;
}

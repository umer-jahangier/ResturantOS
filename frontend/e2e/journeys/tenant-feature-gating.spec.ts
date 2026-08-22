import type { APIRequestContext, Cookie } from "@playwright/test";

import { expect, test } from "../fixtures/auth.fixture";
import { apiLogin, apiPlatformLogin } from "../fixtures/gateway";
import { SUPERADMIN, TENANTS, persona } from "../fixtures/personas";

/**
 * JOURNEY 3 — per-tenant feature gating, asserted at BOTH layers.
 *
 * Both layers are checked because they fail separately and the failure modes are opposite:
 *
 *   UI layer      — useNavItemVisible hides an item whose feature is absent. It FAILS OPEN on
 *                   a feature-fetch error (`failOpenOnError`, use-nav-visibility.ts:26-31), so
 *                   a UI-only assertion could pass with the flag endpoint completely broken.
 *   Gateway layer — FeatureFlagFilter refuses the route outright with 403 FEATURE_DISABLED.
 *                   This is the enforcement; the nav is only decoration over it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH THIS FILE, AND WHY IT WAS WORSE THAN A RED TEST
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * It opened with:
 *
 *     const SAFFRON_MANAGER = persona("terrace", "manager");
 *     const ZAITOON_MANAGER = persona("terrace", "manager");
 *
 * The same persona on the same tenant, under two names — and a sibling test looping
 * `["terrace", "terrace"]`. When the seeder dropped saffron/zaitoon/marina, a tenant-key
 * rewrite pointed every arm at the surviving tenant instead of at the surviving CONTROL. Both
 * arms of an A/B comparison became A. The "denied" call then correctly returned 200 (Floating
 * Terrace has CRM), so the file reported a feature-gating failure while measuring nothing: it
 * could not have caught a completely disabled FeatureFlagFilter, because it never asked a
 * tenant that lacks the module.
 *
 * THE CONTROL TENANT STILL EXISTS. `scripts/seed_restaurantos.py:155-177` keeps
 * "Control Bistro (isolation test tenant)" on purpose, with `overrides: [("FEATURE_CRM",
 * False)]`, and says why in its own comment: "It also keeps feature-gating honest: its module
 * set is deliberately different from Floating Terrace's, so a disabled module is exercised
 * rather than assumed." Verified live on dev 2026-08-22: the tenant is ACTIVE and STARTER, and
 * `GET /api/v1/platform/tenants/{id}/features` reports `FEATURE_CRM: false` with
 * `source: "OVERRIDE_REVOKE"`, `isOverride: true` — a genuine revoke, not a tier artefact
 * (CRM is on by default in every tier).
 *
 * So the divergence is real and this file now names the control tenant instead of aliasing the
 * demo one. It is resolved from the live platform API by brand, never hard-coded, and it is
 * deliberately NOT added to `TENANT_KEYS`: `auth.setup.ts` mints a storage state for every
 * persona of every key and FAILS the whole setup project if one cannot authenticate, so adding
 * a key whose personas are not seeded on an environment would take the entire journeys suite
 * down with it.
 *
 * WHAT IS SKIPPED ON DEV TODAY, AND WHY IT IS A SKIP RATHER THAN A REWRITE. Control Bistro's
 * personas do not authenticate on dev: `owner@control.local` and `manager@control.local` with
 * the documented passwords (`scripts/CREDENTIALS.md:104-125`, derivable from
 * `persona_password`) both return 401 UNAUTHENTICATED — the tenant was provisioned there but
 * `--phase personas` was not run for it. `e2e/fixtures/personas.ts:136` records the same
 * observation independently. Anything needing a control-tenant TOKEN therefore skips with that
 * remedy named, and arms itself the moment the seed runs. Nothing below asserts a weaker claim
 * to go green: the two arms that CAN run without a control session — the platform-layer
 * divergence and the demo tenant's positive nav — run unconditionally and assert in full.
 *
 * Tokens for the demo tenant come from `token()` (a refresh of the minted session), NEVER from
 * a fresh login: this manager is also used by persona-access-matrix.spec.ts, and two concurrent
 * logins as one account race the @Version'd user row into 409 CONCURRENT_MODIFICATION. See
 * fixtures/gateway.ts#tokenViaRefresh.
 */

const DEMO_MANAGER = persona("terrace", "manager");

/** The brand the seed provisions the control tenant under. Joined on, never a hard-coded id. */
const CONTROL_BRAND = "Control Bistro (isolation test tenant)";

/**
 * The control tenant's branch manager, derived exactly the way `seed_restaurantos.py` derives
 * every persona — `persona_email` (L237-238) and `persona_password` (L241-248) over the seed
 * key `control` (L167). Spelled out here rather than obtained from `persona()` because the
 * control tenant is deliberately absent from `TenantKey`; see the note on auth.setup above.
 */
const CONTROL_MANAGER = { email: "manager@control.local", password: "Control#Manager1" };

const SEED_PERSONAS_REMEDY =
  `${CONTROL_MANAGER.email} cannot authenticate on this environment (401 UNAUTHENTICATED), so ` +
  "no token exists for the tenant whose module is revoked and the negative arm of this " +
  "comparison cannot be executed. The tenant itself IS provisioned — the assertion above " +
  "proves its FEATURE_CRM override is live — only its personas are missing. Remedy: " +
  "`python3 scripts/seed_restaurantos.py --phase personas` against this environment. This is " +
  "skipped rather than reworded because the alternative — pointing both arms at the demo " +
  "tenant — is exactly the defect this file was rewritten to remove.";

async function platformToken(gateway: APIRequestContext): Promise<string> {
  const login = await apiPlatformLogin(gateway, {
    email: SUPERADMIN.email,
    password: SUPERADMIN.password,
  });
  expect(
    login.status,
    `SuperAdmin login failed (${login.status} ${login.errorCode ?? ""}). This account is owned ` +
      "by a Liquibase migration in platform-admin-service, not by the seed script.",
  ).toBe(200);
  return login.accessToken!;
}

interface TenantFeatureView {
  tenantId: string;
  slug: string;
  tier: string;
  /** code → enabled, as the platform reports it. */
  features: Record<string, boolean>;
  /** code → how the value was arrived at: TIER_DEFAULT, OVERRIDE_GRANT, OVERRIDE_REVOKE, … */
  source: Record<string, string>;
}

/** Read one tenant's entitlements from the control plane, joined on brand name. */
async function featuresOf(
  gateway: APIRequestContext,
  auth: Record<string, string>,
  brand: string,
): Promise<TenantFeatureView> {
  const list = await gateway.get("/api/v1/platform/tenants?page=0&size=200", { headers: auth });
  expect(list.status(), "the SuperAdmin must be able to list tenants").toBe(200);
  const rows = (await list.json()).data as Array<Record<string, string>>;
  const row = rows.find((t) => t.brandName === brand);
  expect(
    row,
    `"${brand}" is not provisioned on this environment. Run: ` +
      "python3 scripts/seed_restaurantos.py",
  ).toBeTruthy();

  const res = await gateway.get(`/api/v1/platform/tenants/${row!.id}/features`, { headers: auth });
  expect(res.status(), `GET features for ${brand}`).toBe(200);
  const data = (await res.json()).data as {
    features: Record<string, boolean>;
    featureStates: Array<{ code: string; enabled: boolean; source: string }>;
  };

  return {
    tenantId: row!.id!,
    slug: row!.slug!,
    tier: row!.tier!,
    features: data.features,
    source: Object.fromEntries(data.featureStates.map((s) => [s.code, s.source])),
  };
}

/**
 * A live access token for the control tenant's manager, or `null` when its personas are not
 * seeded here. A direct login is correct for this one account: it has no minted storage state
 * (it is not in `ALL_PERSONAS`) and no other spec logs in as it, so the 409 race that forbids
 * fresh logins elsewhere in this suite cannot occur.
 */
interface ControlSession {
  token: string;
  refreshCookies: Cookie[];
}

/**
 * ONE attempt per worker process, cached — including the failure.
 *
 * Two tests below need this session, and a wrong password submitted twice per run is twice the
 * pressure on `failed_login_count` / `locked_until`. Today the account does not exist, so the
 * 401s write nothing; the day it exists with a rotated password, an uncached helper would lock
 * out the control tenant's manager on a schedule and the lockout would look like a seed problem.
 * Caching the null is the point, not an optimisation.
 */
let controlSession: ControlSession | null | undefined;

async function controlManagerToken(
  gateway: APIRequestContext,
  slug: string,
): Promise<ControlSession | null> {
  if (controlSession !== undefined) return controlSession;
  const outcome = await apiLogin(gateway, { ...CONTROL_MANAGER, tenantSlug: slug });
  if (outcome.status !== 200 || !outcome.accessToken) {
    controlSession = null;
    return null;
  }
  const state = await gateway.storageState();
  controlSession = { token: outcome.accessToken, refreshCookies: state.cookies };
  return controlSession;
}

test.describe("per-tenant feature gating", () => {
  /**
   * THE PRECONDITION EVERY OTHER TEST IN THIS FILE RESTS ON, asserted rather than assumed.
   *
   * Without it, a suite that skipped the control-tenant arms would be indistinguishable from a
   * suite whose control tenant had silently lost its override — and the skip messages would be
   * telling everyone to re-seed personas that already exist. This runs on every environment and
   * needs no tenant credentials at all.
   */
  test("platform: the control tenant's module set really does diverge from the demo tenant's", async ({
    gateway,
  }) => {
    const auth = { Authorization: `Bearer ${await platformToken(gateway)}` };

    const control = await featuresOf(gateway, auth, CONTROL_BRAND);
    const demo = await featuresOf(gateway, auth, TENANTS[DEMO_MANAGER.tenantKey].brand);

    expect(
      control.features.FEATURE_CRM,
      `${CONTROL_BRAND} must have FEATURE_CRM revoked — it is the only disabled PRIMARY module ` +
        "in the seed, and every negative feature-gating assertion in this suite depends on it " +
        "(seed_restaurantos.py:167-172).",
    ).toBe(false);

    // CRM is ON by tier default in every tier, so "off" here can only be a deliberate revoke.
    // Asserting the SOURCE is what separates "the seed did this" from "the tier happens to
    // exclude it", and a tier change must not be allowed to quietly satisfy this test.
    expect(
      control.source.FEATURE_CRM,
      "FEATURE_CRM is enabled by TierFeatureDefaults in every tier, so a genuine divergence " +
        "must show as an explicit override. TIER_DEFAULT here would mean the seed's override " +
        "was lost and the control tenant is no longer a control.",
    ).toBe("OVERRIDE_REVOKE");

    expect(
      demo.features.FEATURE_CRM,
      "the demo tenant must have FEATURE_CRM ON — it is the positive arm of the comparison.",
    ).toBe(true);
  });

  /**
   * THE ENFORCEMENT. The nav is decoration; this is the boundary that actually refuses.
   */
  test("gateway: the tenant whose module is revoked is refused FEATURE_DISABLED", async ({
    gateway,
    token,
  }) => {
    const auth = { Authorization: `Bearer ${await platformToken(gateway)}` };
    const control = await featuresOf(gateway, auth, CONTROL_BRAND);

    // The positive arm needs no control persona, so it is asserted BEFORE the skip: an entitled
    // tenant must never be refused at the feature gate, whatever the control tenant's state.
    const allowed = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${await token(DEMO_MANAGER)}` },
      failOnStatusCode: false,
    });
    // NOT asserted as 200 on purpose. FeatureFlagFilter runs at the edge, ahead of routing, so
    // the entitlement question is answered before crm-service is even reached — and crm-service
    // may legitimately be down (the gateway then returns its 503 fallback; observed on the dev
    // stack 2026-08-07). What must never happen for an entitled tenant is FEATURE_DISABLED.
    // Asserting 200 would make this test fail for a reason unrelated to entitlement.
    expect(allowed.status(), "an entitled tenant must not be refused at the feature gate").not.toBe(
      403,
    );

    const session = await controlManagerToken(gateway, control.slug);
    test.skip(session === null, SEED_PERSONAS_REMEDY);

    const denied = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${session!.token}` },
      failOnStatusCode: false,
    });
    expect(
      denied.status(),
      "with FEATURE_CRM revoked for this tenant the gateway's FeatureFlagFilter must refuse " +
        "/api/v1/crm/** outright. A 200 here means the entitlement is not enforced at the edge " +
        "and the nav gate is the only thing hiding the module — which hides nothing from anyone " +
        "willing to call the API.",
    ).toBe(403);
    expect((await denied.json()).error.code).toBe("FEATURE_DISABLED");
  });

  test("flags endpoint reflects the seeded divergence", async ({ gateway, token }) => {
    // Was `for (const key of ["terrace", "terrace"] as const)` — the same tenant twice, so the
    // loop asserted one tenant's flags and called it a divergence. It now iterates the demo
    // tenant's declared expectation once, and the control tenant is covered by the platform-layer
    // test above (which needs no persona) plus the gateway test's negative arm.
    const res = await gateway.get("/api/v1/feature-flags", {
      headers: { Authorization: `Bearer ${await token(DEMO_MANAGER)}` },
    });
    expect(res.status()).toBe(200);
    const features: string[] = (await res.json()).data.features;

    const spec = TENANTS[DEMO_MANAGER.tenantKey];
    for (const on of spec.expectFeatures.on) {
      expect(features, `${spec.key} should have ${on}`).toContain(on);
    }
    for (const off of spec.expectFeatures.off) {
      expect(features, `${spec.key} should NOT have ${off}`).not.toContain(off);
    }
  });

  test("nav: an entitled tenant's manager sees the Customers entry", async ({ as }) => {
    const demo = await as(DEMO_MANAGER);
    await demo.goto("/app/dashboard");
    const nav = demo.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible({ timeout: 20_000 });
    await expect(
      nav.getByRole("link", { name: "Customers", exact: true }),
      "MANAGER holds crm.customer.view and this tenant holds FEATURE_CRM, so nothing may hide " +
        "this entry. If it is absent the nav gate is stricter than the entitlement.",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("nav: the Customers entry disappears for the tenant whose module is revoked", async ({
    gateway,
    browser,
    obs,
  }) => {
    const auth = { Authorization: `Bearer ${await platformToken(gateway)}` };
    const control = await featuresOf(gateway, auth, CONTROL_BRAND);
    const session = await controlManagerToken(gateway, control.slug);
    test.skip(session === null, SEED_PERSONAS_REMEDY);

    // A browser session for a tenant with no minted storage state. Domain and `secure` are
    // DERIVED from the refresh cookie the server just issued, never hardcoded — the same rule
    // auth.setup.ts records at length, because a `domain: "localhost"` marker is silently
    // dropped against a real deployment and every assertion after it fails as a timeout.
    const refresh = session!.refreshCookies.find((c) => c.name === "refresh_token");
    expect(refresh, "the control manager's login set no refresh_token cookie").toBeTruthy();
    const ctx = await browser.newContext();
    await ctx.addCookies([
      { ...refresh!, sameSite: "Strict" as const },
      {
        name: "has_session",
        value: "1",
        domain: refresh!.domain,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: refresh!.secure,
        sameSite: "Strict" as const,
      },
    ]);
    const page = await ctx.newPage();
    obs.watch(page);

    await page.goto("/app/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });

    // Anchor on an item that is NOT feature-gated out first, so "absent" means "gated out"
    // rather than "the sidebar had not rendered yet" — the failure mode a bare toHaveCount(0)
    // would happily accept. `exact: true` is load-bearing: without it this locator also matches
    // "POS Terminals" (sidebar-nav-items.ts:285) and dies on a strict-mode violation, which is
    // how this assertion failed before it ever reached the entitlement question.
    await expect(nav.getByRole("link", { name: "POS", exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      nav.getByRole("link", { name: "Customers", exact: true }),
      "this tenant's FEATURE_CRM is revoked, but its MANAGER — who holds crm.customer.view — " +
        "can still see the Customers entry. Entitlement is not reaching the navigation.",
    ).toHaveCount(0);

    await ctx.close();
  });
});

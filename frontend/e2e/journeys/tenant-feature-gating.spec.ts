import { expect, test } from "../fixtures/auth.fixture";
import { TENANTS, persona } from "../fixtures/personas";

/**
 * JOURNEY 3 — per-tenant feature gating, asserted at BOTH layers.
 *
 * The seed deliberately makes the three tenants' feature sets incomparable rather than
 * nested (scripts/seed_restaurantos.py:124-172): Saffron is STARTER with FEATURE_NLQ
 * overridden ON (it is GROWTH+ by TierFeatureDefaults), Zaitoon is GROWTH with FEATURE_CRM
 * overridden OFF (it is on in every tier by default). Nesting would have let a suite pass by
 * accident; incomparable sets cannot.
 *
 * Both layers are checked because they fail separately and the failure modes are opposite:
 *
 *   UI layer      — useNavItemVisible hides an item whose feature is absent. It FAILS OPEN on
 *                   a feature-fetch error (`failOpenOnError`, use-nav-visibility.ts:26-31), so
 *                   a UI-only assertion could pass with the flag endpoint completely broken.
 *   Gateway layer — FeatureFlagFilter refuses the route outright with 403 FEATURE_DISABLED.
 *                   This is the enforcement; the nav is only decoration over it.
 *
 * Tokens come from `token()` (a refresh of the minted session), NEVER from a fresh login:
 * these managers are also used by persona-access-matrix.spec.ts, and two concurrent logins as
 * one account race the @Version'd user row into 409 CONCURRENT_MODIFICATION. See
 * fixtures/gateway.ts#tokenViaRefresh.
 */

const SAFFRON_MANAGER = persona("saffron", "manager");
const ZAITOON_MANAGER = persona("zaitoon", "manager");

// MANAGER holds crm.customer.view and nlq.query.run (verified live: 49 permission codes), so
// for this role the ONLY thing that can hide these nav items is the feature flag.
test.describe("per-tenant feature gating", () => {
  test("gateway: FEATURE_CRM off for Zaitoon, on for Saffron", async ({ gateway, token }) => {
    const denied = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${await token(ZAITOON_MANAGER)}` },
      failOnStatusCode: false,
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("FEATURE_DISABLED");

    const allowed = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
      headers: { Authorization: `Bearer ${await token(SAFFRON_MANAGER)}` },
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
  });

  test("flags endpoint reflects the seeded divergence", async ({ gateway, token }) => {
    for (const key of ["saffron", "zaitoon"] as const) {
      const res = await gateway.get("/api/v1/feature-flags", {
        headers: { Authorization: `Bearer ${await token(persona(key, "manager"))}` },
      });
      expect(res.status()).toBe(200);
      const features: string[] = (await res.json()).data.features;

      for (const on of TENANTS[key].expectFeatures.on) {
        expect(features, `${key} should have ${on}`).toContain(on);
      }
      for (const off of TENANTS[key].expectFeatures.off) {
        expect(features, `${key} should NOT have ${off}`).not.toContain(off);
      }
    }
  });

  test("nav: the Customers entry follows the tenant's entitlement", async ({ as }) => {
    const saffron = await as(SAFFRON_MANAGER);
    await saffron.goto("/app/dashboard");
    const saffronNav = saffron.getByRole("navigation", { name: "Primary" });
    await expect(saffronNav).toBeVisible({ timeout: 20_000 });
    await expect(saffronNav.getByRole("link", { name: "Customers" })).toBeVisible({
      timeout: 20_000,
    });

    const zaitoon = await as(ZAITOON_MANAGER);
    await zaitoon.goto("/app/dashboard");
    const zaitoonNav = zaitoon.getByRole("navigation", { name: "Primary" });
    await expect(zaitoonNav).toBeVisible({ timeout: 20_000 });
    // Wait for a nav item that is NOT feature-gated out first, so "absent" means "gated out"
    // rather than "the sidebar had not rendered yet" — the failure mode a bare toHaveCount(0)
    // would happily accept.
    await expect(zaitoonNav.getByRole("link", { name: "POS" })).toBeVisible({ timeout: 20_000 });
    await expect(zaitoonNav.getByRole("link", { name: "Customers" })).toHaveCount(0);
  });
});

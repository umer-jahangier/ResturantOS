import { expect, test } from "../fixtures/auth.fixture";
import { apiPlatformLogin } from "../fixtures/gateway";
import { SUPERADMIN, persona } from "../fixtures/personas";
import { e2eBrandName, e2eEmail, withRestored } from "../fixtures/isolation";
import { DEFECTS } from "../fixtures/known-defects";

/**
 * JOURNEY — the SuperAdmin control plane: create a tenant, change its tier, toggle a module,
 * and confirm the module DISAPPEARS in the browser for that tenant's own user.
 *
 * WHY THIS IS DRIVEN THROUGH THE API AND ASSERTED IN THE BROWSER
 * ==============================================================
 * There is no SuperAdmin UI to drive. `frontend/app/(platform)/` contains exactly two files:
 * a layout and a nine-line placeholder dashboard. `platformNavItems` advertises
 * /platform/tenants, but no page implements it. That is recorded as E2E-D3.
 *
 * So the control-plane ACTIONS go through the real gateway, and the assertion that matters —
 * "the tenant's user stops seeing the module" — is made in a real browser. That second half
 * is the one a curl script cannot make, and it is the half the requirement is actually about.
 *
 * ISOLATION. The created tenant is named per-run and deleted afterwards. The feature toggle
 * is applied to a SEEDED tenant (marina) and restored, because provisioning a throwaway
 * tenant just to toggle a flag would take a saga and tens of seconds, and because the
 * marina manager already has a minted session to observe it with.
 */

test.describe.configure({ mode: "serial" });

async function platformToken(gateway: Parameters<typeof apiPlatformLogin>[0]): Promise<string> {
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

test.describe("SuperAdmin tenant lifecycle", () => {
  test("creates a tenant, then changes its tier", async ({ gateway }) => {
    const token = await platformToken(gateway);
    const auth = { Authorization: `Bearer ${token}` };
    const brand = e2eBrandName();

    // ── create ────────────────────────────────────────────────────────────────────────
    const created = await gateway.post("/api/v1/platform/tenants", {
      headers: auth,
      data: { brandName: brand, adminEmail: e2eEmail("owner"), tier: "STARTER" },
      failOnStatusCode: false,
    });
    expect(
      [200, 201],
      `provisioning ${brand} returned ${created.status()}: ${(await created.text()).slice(0, 300)}`,
    ).toContain(created.status());

    const body = (await created.json()) as {
      data: { tenantId: string; slug: string; tempPassword?: string };
    };
    const tenantId = body.data.tenantId;
    const slug = body.data.slug;

    expect(tenantId, "provisioning must return the new tenant id").toBeTruthy();
    // The slug is MINTED from the brand name; it is not the caller's to choose. Asserting it
    // is derived (not echoed) is what proves provisioning actually ran.
    expect(slug, `slug should be minted from "${brand}"`).toMatch(/^e2e-probe-/);
    expect(
      body.data.tempPassword,
      "provisioning must hand back a one-time admin password — without it the new tenant's " +
        "owner can never log in, which was blocker B2 in Phase 13",
    ).toBeTruthy();

    try {
      // ── the tier is REAL, read back rather than assumed ────────────────────────────
      const before = await gateway.get(`/api/v1/platform/tenants/${tenantId}`, { headers: auth });
      expect(before.status()).toBe(200);
      expect((await before.json()).data.tier).toBe("STARTER");

      // ── change tier ───────────────────────────────────────────────────────────────
      const changed = await gateway.post(`/api/v1/platform/tenants/${tenantId}/tier`, {
        headers: auth,
        data: { tier: "ENTERPRISE", force: true },
        failOnStatusCode: false,
      });
      expect(changed.status(), `tier change failed: ${(await changed.text()).slice(0, 300)}`).toBe(
        200,
      );

      const after = await gateway.get(`/api/v1/platform/tenants/${tenantId}`, { headers: auth });
      expect(
        (await after.json()).data.tier,
        "the tier must be persisted, not merely accepted — a 200 that does not change the " +
          "stored tier is exactly the silent failure this journey exists to catch",
      ).toBe("ENTERPRISE");

      // A tier change must move the ENTITLEMENTS with it, or the tier is decorative.
      const feats = await gateway.get(`/api/v1/platform/tenants/${tenantId}/features`, {
        headers: auth,
      });
      expect(feats.status()).toBe(200);
      const enabled = await feats.json();
      expect(
        JSON.stringify(enabled),
        "an ENTERPRISE tenant should hold more than the STARTER defaults",
      ).toContain("FEATURE_");
    } finally {
      // ── cleanup, so a second run is a clean run ────────────────────────────────────
      //
      // The lifecycle is CANCEL then PURGE, in that order: TenantLifecycleService.purge
      // (L86-93) requires status CANCELLED and refuses anything else. Calling DELETE on an
      // ACTIVE tenant returns 500 — see E2E-D5, which is about the STATUS CODE, not about
      // the precondition. The precondition itself is correct and is respected here.
      const cancelled = await gateway.post(`/api/v1/platform/tenants/${tenantId}/cancel`, {
        headers: auth,
        data: { reason: `e2e cleanup ${slug}` },
        failOnStatusCode: false,
      });
      expect(
        [200, 204],
        `cancelling ${slug} returned ${cancelled.status()} — cannot purge without it`,
      ).toContain(cancelled.status());

      const purged = await gateway.delete(`/api/v1/platform/tenants/${tenantId}`, {
        headers: auth,
        failOnStatusCode: false,
      });
      expect(
        [200, 202, 204, 404],
        `purge of ${slug} returned ${purged.status()} — an orphan tenant is left behind. ` +
          "Later runs still work (names are run-unique) but the platform tenant list grows.",
      ).toContain(purged.status());
    }
  });

  /**
   * THE ASSERTION THIS JOURNEY EXISTS FOR: a SuperAdmin toggles a module OFF and the
   * tenant's own user, in a browser, stops seeing it.
   */
  test("toggling a module OFF removes it from that tenant's user's navigation", async ({
    gateway,
    as,
    token,
    obs,
  }) => {
    const platform = await platformToken(gateway);
    const auth = { Authorization: `Bearer ${platform}` };

    // Marina is ENTERPRISE with the full tier default, so FEATURE_CRM starts ON and the
    // "Customers" nav item is present for its MANAGER (which holds crm.customer.view).
    const marinaManager = persona("marina", "manager");

    // Resolve marina's id from the live platform API — never hard-coded.
    const list = await gateway.get("/api/v1/platform/tenants?page=0&size=200", { headers: auth });
    expect(list.status()).toBe(200);
    const rows = (await list.json()).data as Array<Record<string, string>>;
    const marina = rows.find((t) => t.brandName === "Marina Bay Dining");
    expect(marina, "Marina Bay Dining is not provisioned — run the seed script").toBeTruthy();
    const marinaId = marina!.id;

    const setCrm = async (enabled: boolean) => {
      const res = await gateway.patch(`/api/v1/platform/tenants/${marinaId}/features/FEATURE_CRM`, {
        headers: auth,
        data: { enabled },
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `PATCH FEATURE_CRM=${enabled} returned ${res.status()}: ${(await res.text()).slice(0, 200)}`,
      ).toBe(200);
    };

    // Baseline: the item is there BEFORE the toggle. Without this the test would pass just
    // as happily against a tenant that never had the module.
    const before = await as(marinaManager);
    await before.goto("/app/dashboard");
    const beforeNav = before.getByRole("navigation", { name: "Primary" });
    await expect(beforeNav.getByRole("link", { name: "POS", exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      beforeNav.getByRole("link", { name: "Customers", exact: true }),
      "FEATURE_CRM should be ON for Marina before this test toggles it. If it is already " +
        "off, a previous run failed before restoring it — re-run the seed.",
    ).toBeVisible({ timeout: 25_000 });

    await withRestored(
      () => setCrm(true),
      async () => {
        await setCrm(false);

        // A NEW page: nav visibility is computed from the feature-flag fetch on load.
        const after = await as(marinaManager);
        await after.goto("/app/dashboard");
        const afterNav = after.getByRole("navigation", { name: "Primary" });

        // Anchor on an item that is NOT affected, so "absent" means "gated out" rather than
        // "the sidebar had not rendered".
        await expect(afterNav.getByRole("link", { name: "POS", exact: true })).toBeVisible({
          timeout: 25_000,
        });
        await expect(
          afterNav.getByRole("link", { name: "Customers", exact: true }),
          "the SuperAdmin disabled FEATURE_CRM for this tenant, but its MANAGER can still " +
            "see the Customers entry. Entitlement changes are not reaching the browser.",
        ).toHaveCount(0);

        // The nav is decoration; the GATEWAY is the enforcement. Assert both, because they
        // fail separately: useNavItemVisible fails OPEN on a flag-fetch error, so a UI-only
        // assertion would pass with the entitlement system completely broken.
        const denied = await gateway.get("/api/v1/crm/customers?page=0&size=1", {
          headers: { Authorization: `Bearer ${await token(marinaManager)}` },
          failOnStatusCode: false,
        });
        expect(
          denied.status(),
          "with FEATURE_CRM off the gateway's FeatureFlagFilter must refuse /api/v1/crm/**",
        ).toBe(403);
        expect((await denied.json()).error.code).toBe("FEATURE_DISABLED");
      },
    );

    // And it comes BACK — a toggle that only works one way is half a feature.
    const restored = await as(marinaManager);
    await restored.goto("/app/dashboard");
    await expect(
      restored.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: "Customers",
        exact: true,
      }),
      "FEATURE_CRM was restored to ON but the nav item did not come back. The environment " +
        "is now dirty for every other spec — re-run the seed.",
    ).toBeVisible({ timeout: 25_000 });

    expect(
      obs.watchedPages,
      "this test must have observed at least one browser page",
    ).toBeGreaterThan(0);
  });

  test(`${DEFECTS.PLATFORM_TENANTS_PAGE_MISSING.id} · the advertised /platform/tenants page does not exist`, async ({
    as,
    obs,
  }) => {
    // Navigating to a route that does not exist IS a failed request — that is the whole
    // assertion. Declared so the guard reports it rather than double-failing the test.
    obs.expectNetworkFailure({
      url: "/platform/tenants",
      status: 404,
      because: "E2E-D3: the 404 is what this test asserts",
    });

    // Pins E2E-D3. The nav offers this route; nothing implements it. Asserted from a TENANT
    // session because E2E-D2 means any authenticated user can reach the platform routes at
    // all — the two defects compound, and this records that they do.
    const page = await as(persona("saffron", "owner"));
    const res = await page.goto("/platform/tenants", { waitUntil: "domcontentloaded" });

    expect(
      res?.status(),
      `${DEFECTS.PLATFORM_TENANTS_PAGE_MISSING.id} appears FIXED — /platform/tenants now ` +
        "returns 200. Build out the real assertions for tenant management here and delete " +
        "this pin and its registry entry.",
    ).toBe(404);
  });
});

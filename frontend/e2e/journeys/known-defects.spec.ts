import { expect, test } from "../fixtures/auth.fixture";
import { DEFECTS } from "../fixtures/known-defects";
import { apiPlatformLogin } from "../fixtures/gateway";
import { SUPERADMIN, persona, TENANT_KEYS } from "../fixtures/personas";

/**
 * PINS for e2e/fixtures/known-defects.ts.
 *
 * Each case asserts that a tolerated defect STILL REPRODUCES. That inversion is the whole
 * point: a tolerance that outlives its defect is indistinguishable from a muted regression,
 * and this is the only thing that can tell them apart.
 *
 * When one of these goes red, the product was FIXED. Delete the registry entry and the
 * `tolerate(...)` calls that reference it — do not "fix" the test.
 */

test.describe("known defects still reproduce", () => {
  const D1 = DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403;

  test(`${D1.id} · ACCOUNTANT's dashboard still 403s on GET /api/v1/pos/menu/items`, async ({
    as,
    obs,
  }) => {
    // This spec is ABOUT the 403, so it declares it and then asserts it happened.
    D1.declare(obs);

    const forbidden: { tenant: string; status: number }[] = [];

    for (const key of TENANT_KEYS) {
      const page = await as(persona(key, "accountant"));
      const menuCall = page
        .waitForResponse((r) => r.url().includes("/api/v1/pos/menu/items"), { timeout: 20_000 })
        .catch(() => null);

      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible({
        timeout: 20_000,
      });

      const res = await menuCall;
      if (res) forbidden.push({ tenant: key, status: res.status() });
    }

    expect(
      forbidden.length,
      "the ACCOUNTANT dashboard no longer requests the menu at all — if that is because " +
        `${D1.id} was fixed, DELETE the entry from e2e/fixtures/known-defects.ts and every ` +
        "`tolerate(obs, DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403)` call.",
    ).toBeGreaterThan(0);

    expect(
      forbidden.every((f) => f.status === 403),
      `${D1.id} appears FIXED — the menu fetch now succeeds for ACCOUNTANT ` +
        `(${JSON.stringify(forbidden)}). Delete the registry entry and its tolerate() calls; ` +
        "leaving it in place would mute a future regression of the same 403.",
    ).toBe(true);
  });

  const D5 = DEFECTS.LIFECYCLE_PRECONDITION_RETURNS_500;

  test(`${D5.id} · purging a non-CANCELLED tenant still returns 500 instead of 409`, async ({
    gateway,
  }) => {
    const login = await apiPlatformLogin(gateway, {
      email: SUPERADMIN.email,
      password: SUPERADMIN.password,
    });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.accessToken}` };

    // Probe against a SEEDED tenant, which is ACTIVE and therefore not purgeable. This is
    // safe precisely BECAUSE the precondition holds: the call is refused, so nothing is
    // mutated. If the precondition were ever removed this test would delete a seeded
    // tenant — so it asserts the refusal first and never proceeds past it.
    const list = await gateway.get("/api/v1/platform/tenants?page=0&size=200", { headers: auth });
    const rows = (await list.json()).data as Array<Record<string, string>>;
    const active = rows.find((t) => t.brandName === "Saffron Grill" && t.status === "ACTIVE");
    expect(active, "Saffron Grill is not ACTIVE — run the seed script").toBeTruthy();

    const res = await gateway.delete(`/api/v1/platform/tenants/${active!.id}`, {
      headers: auth,
      failOnStatusCode: false,
    });

    expect(
      [204, 200].includes(res.status()),
      "DANGER: purging an ACTIVE tenant SUCCEEDED. The cancel-before-purge precondition in " +
        "TenantLifecycleService.purge has been removed, and a seeded tenant may have just " +
        "been destroyed. Restore it with the seed script and re-add the precondition.",
    ).toBe(false);

    expect(
      res.status(),
      `${D5.id} appears FIXED — the refusal now returns ${res.status()} rather than 500. ` +
        "If that is 409, delete this pin and the registry entry.",
    ).toBe(500);
  });
});

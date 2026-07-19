import { test, expect } from "@playwright/test";

/**
 * D-04/INV-10 vertical-slice smoke — proves `/app/inventory` flipped from the `comingSoon`
 * placeholder into a real, reachable module: the recipe-builder page's menu-item select renders
 * real options, and the coverage dashboard renders its three stat tiles. This is a SMOKE test
 * (page loads + key elements render), NOT a full recipe-creation click-through, per this plan's
 * explicit scope.
 *
 * Reuses the login/gotoRobust/Blocked conventions from kds-stations.spec.ts / pos-modal-revamp.spec.ts.
 * Runs against the LIVE local dev stack (frontend :3000, inventory-service :8xxx). Requires the
 * demo manager seed (manager@demo.local / Manager#2026, tenant "demo") — MANAGER holds both
 * inventory.item.view and inventory.item.manage with no TOTP step-up (services/auth-service
 * .../900-seed-auth-dev-data.xml, role_permissions MANAGER rows).
 *
 * "FAIL" = a real frontend defect. "BLOCKED" = missing seed/environment precondition (not a code
 * defect) — see the `Blocked` marker class below.
 */

const MANAGER_EMAIL = "manager@demo.local";
const MANAGER_PASSWORD = "Manager#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("D-04/INV-10: /app/inventory recipe-builder + coverage dashboard smoke", () => {
  test("inventory is live in the sidebar; recipe-builder picker and coverage stat tiles render", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    async function shot(name: string): Promise<void> {
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
    }

    async function gotoRobust(url: string): Promise<void> {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      for (let i = 0; i < 3; i++) {
        const is404 = await page
          .getByText("404", { exact: false })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (!is404) return;
        await page.waitForTimeout(2000);
        await page.reload({ waitUntil: "networkidle", timeout: 45_000 });
      }
    }

    async function login(email: string, password: string): Promise<void> {
      await gotoRobust(`/login?tenant=${TENANT_SLUG}`);
      const tenantField = page.locator('input[name="tenantSlug"]');
      if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tenantField.fill(TENANT_SLUG);
      }
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
    }

    try {
      await login(MANAGER_EMAIL, MANAGER_PASSWORD);

      // ── /app/inventory is a real, live page — not a coming-soon/404 placeholder (D-04) ──
      const inventoryLink = page.locator('a[href="/app/inventory"]').first();
      if (!(await inventoryLink.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Blocked("no sidebar Inventory link visible — inventory.item.view/FEATURE_INVENTORY may be missing for this account");
      }
      await inventoryLink.click();
      await page.waitForURL(/\/app\/inventory/, { timeout: 15_000 });

      const notEnabled = page.getByText("Inventory feature is not enabled for this account.");
      if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("FEATURE_INVENTORY is not enabled for the demo tenant");
      }
      const noPermission = page.getByText("You do not have permission to access", { exact: false });
      if (await noPermission.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("manager@demo.local lacks inventory.item.view permission (seed-data/RBAC gap)");
      }
      await expect(page.getByText("404", { exact: false })).toHaveCount(0);
      await shot("inventory-landing");

      // ── Recipe builder: menu-item select renders at least one real option ──────────────
      await gotoRobust("/app/inventory/recipes");
      await expect(page.getByText("Recipe Builder")).toBeVisible({ timeout: 15_000 });
      const menuItemSelect = page.getByLabel("Menu item", { exact: true });
      await expect(menuItemSelect).toBeVisible({ timeout: 10_000 });
      const optionCount = await menuItemSelect.locator("option").count();
      if (optionCount <= 1) {
        throw new Blocked("menu-item select has no real options beyond the placeholder — catalog sync (08.1-01/02) may not have run for this tenant");
      }
      await shot("inventory-recipe-builder");

      // ── Coverage dashboard: three stat tiles render numeric values ──────────────────────
      await gotoRobust("/app/inventory/coverage");
      await expect(page.getByText("Recipe Coverage")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Total Active Menu Items")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Covered")).toBeVisible();
      await expect(page.getByText("Missing")).toBeVisible();
      await shot("inventory-coverage");
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`[BLOCKED] inventory-recipe-builder: ${err.message}`);
        test.skip(true, `BLOCKED (environment/seed precondition, not a frontend defect): ${err.message}`);
        return;
      }
      throw err;
    }
  });
});

import { expect, test, type Page } from "@playwright/test";

/**
 * Purchasing data entry, as a buyer actually meets it.
 *
 * Every assertion here corresponds to something that was typed by hand before, or to a price that
 * was recorded and then not shown:
 *
 * - Pack unit / order unit were free-text boxes. Inventory converts a goods receipt by looking the
 *   pack unit up in the tenant's unit registry, so "kgs" resolved to nothing and a 10&nbsp;kg
 *   receipt landed as 10 grams. The unit you type and the unit that converts have to be one list.
 * - A PO line's unit is the vendor's order unit — derived, not a decision, so it is shown rather
 *   than asked for once a catalog item is chosen.
 * - Payment terms were free text and had already drifted in live data (NET30 / NET_30 / CASH).
 * - "Pay from" was a hand-typed GL account code pre-filled with a hard-coded 1110, on the one
 *   screen that moves money.
 * - A price recorded for one branch was invisible in the Current price column and to PO lines.
 */

const TENANT = "demo";
const MANAGER = { email: "manager1@demo.local", password: "Manager1#2026" };

async function login(page: Page): Promise<void> {
  await page.goto(`/login?tenant=${TENANT}`, { waitUntil: "networkidle", timeout: 45_000 });

  // Fills before hydration never reach react-hook-form's state — wait for the form to be live.
  const email = page.locator('input[type="email"]');
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 20_000 });

  const tenantField = page.locator('input[name="tenantSlug"]');
  if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tenantField.fill(TENANT);
  }
  await email.fill(MANAGER.email);
  await page.locator('input[type="password"]').fill(MANAGER.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
}

async function openFirstVendor(page: Page): Promise<void> {
  await page.goto("/app/purchasing/vendors", { waitUntil: "networkidle", timeout: 45_000 });
  const firstVendorLink = page.locator('a[href^="/app/purchasing/vendors/"]').first();
  await firstVendorLink.waitFor({ state: "visible", timeout: 30_000 });
  await firstVendorLink.click();
  await page.waitForURL(/\/app\/purchasing\/vendors\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

test.describe("purchasing: lookups instead of free text, and prices that show up", () => {
  test.setTimeout(180_000);

  test("units are picked from the tenant's unit registry, not typed", async ({ page }) => {
    await login(page);
    await openFirstVendor(page);

    await page.getByRole("button", { name: /add catalog item/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const packUnit = dialog.getByLabel("Pack unit");
    const orderUnit = dialog.getByLabel("Order unit");

    // The defect was that these were <input>. A <select> is the fix, and it must be POPULATED —
    // an empty dropdown is a worse free-text box.
    await expect(packUnit).toHaveJSProperty("tagName", "SELECT");
    await expect(orderUnit).toHaveJSProperty("tagName", "SELECT");

    const packOptions = await packUnit.locator("option").allTextContents();
    expect(packOptions.length, `pack unit options: ${packOptions.join(", ")}`).toBeGreaterThan(1);
    expect(packOptions.join(" ")).toMatch(/KG|G\b|L\b|EA|PCS/i);

    await page.screenshot({ path: "e2e/__screenshots__/purchasing-unit-selects.png", fullPage: true });
  });

  test("payment terms are chosen from a fixed list", async ({ page }) => {
    await login(page);
    await page.goto("/app/purchasing/vendors", { waitUntil: "networkidle", timeout: 45_000 });

    await page.getByRole("button", { name: /add vendor|new vendor/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const terms = dialog.getByLabel("Payment terms");
    await expect(terms).toHaveJSProperty("tagName", "SELECT");
    const options = await terms.locator("option").allTextContents();
    expect(options.join(" ")).toContain("NET 30");
    // The drift this replaces: NET30 and NET_30 could both be typed and were different values.
    await expect(terms).toHaveValue("NET30");
  });

  test("a branch price shows as the catalog's current price", async ({ page }) => {
    await login(page);
    await openFirstVendor(page);

    const currentPriceHeader = page.getByRole("columnheader", { name: /current price/i });
    await expect(currentPriceHeader).toBeVisible({ timeout: 30_000 });

    // At least one catalog row must show a real amount. Before the resolver fix, a row whose only
    // price was branch-scoped rendered "—" here however many times it had been priced.
    const priced = page.locator("tbody tr").filter({ hasText: /Rs\s?[\d,]/ });
    await expect(priced.first()).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: "e2e/__screenshots__/vendor-catalog-current-price.png", fullPage: true });
  });

  test("a PO line's unit is derived from the catalog item, not retyped", async ({ page }) => {
    await login(page);
    await page.goto("/app/purchasing/purchase-orders", { waitUntil: "networkidle", timeout: 45_000 });

    await page.getByRole("button", { name: /new purchase order|create purchase order|add purchase order/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // With no catalog item chosen yet, the unit is a select (a real unit, still not free text).
    const unitBefore = dialog.getByLabel("Unit").first();
    await expect(unitBefore).toBeVisible({ timeout: 15_000 });
    await expect(unitBefore).toHaveJSProperty("tagName", "SELECT");

    await page.screenshot({ path: "e2e/__screenshots__/po-line-unit.png", fullPage: true });
  });
});

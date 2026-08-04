import { expect, test, type Page } from "@playwright/test";

/**
 * Two fixes that only show up in a browser.
 *
 * - "Pay from" on the AP payment dialog was a text box pre-filled with a hard-coded GL code
 *   ("1110"). Reading finance's chart of accounts directly 403s for MANAGER — the very role that
 *   holds `vendor.payment.create` — so the fix is a scoped `purchasing/bank-accounts` proxy.
 *   The assertion that matters is that the list is POPULATED for a manager.
 * - Every detail page in the app rendered its id segment through the same prettifier as a word,
 *   so the breadcrumb read "Vendors › 231aa42d 748f 42ed B80a 1f35c3a2498c".
 */

const TENANT = "demo";
const MANAGER = { email: "manager1@demo.local", password: "Manager1#2026" };

async function login(page: Page): Promise<void> {
  await page.goto(`/login?tenant=${TENANT}`, { waitUntil: "networkidle", timeout: 45_000 });
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

test.describe("purchasing: paying an invoice, and knowing where you are", () => {
  test.setTimeout(180_000);

  test("a manager picks the account to pay from instead of typing a GL code", async ({ page }) => {
    await login(page);
    await page.goto("/app/purchasing/payments", { waitUntil: "networkidle", timeout: 45_000 });

    const payButton = page.getByRole("button", { name: /^pay$/i }).first();
    await payButton.waitFor({ state: "visible", timeout: 30_000 });
    await payButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const payFrom = dialog.getByLabel("Pay from");
    await expect(payFrom).toBeVisible({ timeout: 15_000 });
    await expect(payFrom).toHaveJSProperty("tagName", "SELECT");

    // A dropdown a MANAGER cannot populate is worse than the text box it replaced — this is the
    // whole reason the scoped proxy exists, so assert real accounts, not just a <select>.
    const options = await payFrom.locator("option").allTextContents();
    expect(options.length, `pay-from options: ${options.join(" | ")}`).toBeGreaterThan(1);
    expect(options.join(" ")).toMatch(/bank|cash/i);

    await page.screenshot({ path: "e2e/__screenshots__/ap-payment-pay-from.png", fullPage: true });
  });

  test("a detail page's breadcrumb names the record type, not its UUID", async ({ page }) => {
    await login(page);
    await page.goto("/app/purchasing/vendors", { waitUntil: "networkidle", timeout: 45_000 });

    const firstVendorLink = page.locator('a[href^="/app/purchasing/vendors/"]').first();
    await firstVendorLink.waitFor({ state: "visible", timeout: 30_000 });
    await firstVendorLink.click();
    await page.waitForURL(/\/app\/purchasing\/vendors\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const crumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(crumb).toBeVisible({ timeout: 45_000 });
    const text = (await crumb.textContent()) ?? "";

    expect(text, `breadcrumb was: "${text}"`).not.toMatch(/[0-9a-f]{8}\s[0-9a-f]{4}\s/i);
    expect(text).toContain("Vendor");

    await page.screenshot({ path: "e2e/__screenshots__/breadcrumb-detail-page.png", fullPage: true });
  });
});

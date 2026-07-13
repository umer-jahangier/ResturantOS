// Ad-hoc Playwright UAT script for Phase 07 — offline PWA order creation/sync (Test 9).
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const SHOT_DIR = "D:/GitHub/ResturantOS/.dev-uat-screenshots";
fs.mkdirSync(SHOT_DIR, { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);
async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  log("screenshot:", p);
}
async function gotoRobust(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3; i++) {
    const is404 = await page.locator("text=404").first().isVisible().catch(() => false);
    if (!is404) return;
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);
  }
}
async function login(page, email, password) {
  await gotoRobust(page, `${BASE}/login?tenant=demo`);
  const tenantField = page.locator('input[name="tenantSlug"]');
  if (await tenantField.isVisible({ timeout: 2000 }).catch(() => false)) await tenantField.fill("demo");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (await page.locator("text=404").first().isVisible().catch(() => false)) {
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "allow" });
  const page = await context.newPage();
  const results = {};
  try {
    await login(page, "cashier@demo.local", "Cashier#2026");
    log("=== Warm up POS page (register SW) while online ===");
    await gotoRobust(page, `${BASE}/app/pos`);
    await page.waitForSelector('[data-testid="menu-grid"]', { timeout: 15000 });
    await page.waitForTimeout(2000); // let SW finish registering

    log("=== Go offline ===");
    await context.setOffline(true);
    await page.waitForTimeout(1000);
    results.offlineBannerVisible = await page.locator('[data-testid="offline-banner"]').isVisible({ timeout: 5000 }).catch(() => false);
    await shot(page, "20-offline-banner");

    log("=== Create order while offline ===");
    const firstItem = page.locator('[data-testid="menu-item-first"]');
    if (await firstItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstItem.click();
      await page.waitForTimeout(2000);
      await shot(page, "21-offline-order-created");
      results.syncBadgeVisible = await page.locator('[data-testid="sync-badge"]').isVisible({ timeout: 5000 }).catch(() => false);
      results.syncBadgeText = results.syncBadgeVisible
        ? await page.locator('[data-testid="sync-badge"]').textContent().catch(() => null)
        : null;
    } else {
      results.firstItemVisibleOffline = false;
    }

    log("=== Reload while still offline (IndexedDB persistence check) ===");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    results.syncBadgeVisibleAfterReload = await page.locator('[data-testid="sync-badge"]').isVisible({ timeout: 5000 }).catch(() => false);
    await shot(page, "22-after-reload-offline");

    log("=== Go back online — sync should drain ===");
    await context.setOffline(false);
    await page.waitForTimeout(5000);
    results.syncBadgeHiddenAfterReconnect = await page.locator('[data-testid="sync-badge"]').isHidden({ timeout: 10000 }).catch(() => false);
    await shot(page, "23-after-reconnect");
  } catch (err) {
    results.fatalError = String(err);
    await shot(page, "99-fatal-error-offline");
  }
  fs.writeFileSync(path.join(SHOT_DIR, "offline-flow-results.json"), JSON.stringify(results, null, 2));
  log("RESULTS:", JSON.stringify(results, null, 2));
  await browser.close();
}
main();

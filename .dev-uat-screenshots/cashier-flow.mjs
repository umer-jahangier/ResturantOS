// Ad-hoc Playwright UAT script for Phase 07 — cashier flow.
// Run with: node cashier-flow.mjs (from frontend/ so @playwright/test resolves)
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
  // Turbopack dev-server sometimes serves a transient 404 for a route it's still
  // compiling for the first time; reload once or twice if we see that.
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
  if (await tenantField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tenantField.fill("demo");
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Same transient-404-on-first-compile issue can hit the post-login landing page.
  const is404 = await page.locator("text=404").first().isVisible().catch(() => false);
  if (is404) {
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const results = {};

  try {
    log("=== LOGIN as cashier@demo.local ===");
    await login(page, "cashier@demo.local", "Cashier#2026");
    await shot(page, "01-cashier-post-login");
    results.loginUrl = page.url();

    log("=== Check sidebar nav (Test 10 - cashier should see POS, NOT Kitchen Display) ===");
    const sidebarText = await page.locator("body").innerText();
    results.sidebarHasPos = sidebarText.includes("POS");
    results.sidebarHasKitchen = sidebarText.includes("Kitchen Display");
    await shot(page, "02-cashier-sidebar");

    log("=== Navigate to POS terminal ===");
    await gotoRobust(page, `${BASE}/app/pos`);
    await shot(page, "03-pos-terminal-initial");

    const menuGridVisible = await page.locator('[data-testid="menu-grid"]').isVisible().catch(() => false);
    results.menuGridVisible = menuGridVisible;

    log("=== Try Floor View tab ===");
    await page.getByText("Floor View", { exact: true }).click();
    await page.waitForTimeout(800);
    await shot(page, "04-floor-view");
    const tableButtons = await page.locator('[data-testid^="table-"]').count();
    results.tableButtonsCount = tableButtons;

    // Back to terminal to add items (table selection has no onTableSelect wired per source read)
    await page.getByText("POS Terminal", { exact: true }).click();
    await page.waitForTimeout(500);

    log("=== Add first menu item (Test 2: create order) ===");
    const firstItem = page.locator('[data-testid="menu-item-first"]');
    await firstItem.waitFor({ state: "visible", timeout: 10000 });
    await firstItem.click();
    await page.waitForTimeout(1500);
    await shot(page, "05-after-first-item");

    const orderStatusText = await page.locator("text=/OPEN|DRAFT|SENT_TO_KDS/").first().textContent().catch(() => null);
    results.orderStatusAfterFirstItem = orderStatusText;

    // Add a second item too if grid has more
    const items = page.locator('[data-testid="menu-grid"] button, [data-testid="menu-grid"] [role="button"]');
    const itemCount = await items.count().catch(() => 0);
    results.menuItemCount = itemCount;
    if (itemCount > 1) {
      await items.nth(1).click();
      await page.waitForTimeout(1000);
      await shot(page, "06-after-second-item");
    }

    log("=== Look for Send to Kitchen button ===");
    const sendBtn = page.getByRole("button", { name: /send to kitchen/i });
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    results.sendToKitchenVisible = sendVisible;
    if (sendVisible) {
      const disabled = await sendBtn.isDisabled();
      results.sendToKitchenDisabledBeforeItems = disabled;
      if (!disabled) {
        await sendBtn.click();
        await page.waitForTimeout(1500);
        await shot(page, "07-after-send-to-kitchen");
        const statusAfterSend = await page.locator("text=/SENT_TO_KDS/").first().isVisible().catch(() => false);
        results.orderShowsSentToKds = statusAfterSend;
      }
    }

    log("=== Look for CHARGE NOW / payment panel ===");
    const chargeBtn = page.getByRole("button", { name: /charge now/i });
    results.chargeNowVisible = await chargeBtn.isVisible().catch(() => false);
    results.chargeNowDisabled = results.chargeNowVisible ? await chargeBtn.isDisabled() : null;
    results.chargeNowTitle = results.chargeNowVisible
      ? await chargeBtn.getAttribute("title").catch(() => null)
      : null;

    log("=== Look for Till bar (open/close till) ===");
    results.tillBarVisible = await page.getByText(/till/i).first().isVisible().catch(() => false);

    log("=== Look for Void button ===");
    results.voidButtonVisible = await page.getByRole("button", { name: /^void$/i }).isVisible().catch(() => false);

    await shot(page, "08-pos-terminal-final-state");

    results.consoleErrors = consoleErrors;
  } catch (err) {
    results.fatalError = String(err);
    await shot(page, "99-fatal-error-cashier");
  }
  results.consoleErrors = results.consoleErrors ?? consoleErrors;

  fs.writeFileSync(
    path.join(SHOT_DIR, "cashier-flow-results.json"),
    JSON.stringify(results, null, 2)
  );
  log("RESULTS:", JSON.stringify(results, null, 2));

  await browser.close();
}

main();

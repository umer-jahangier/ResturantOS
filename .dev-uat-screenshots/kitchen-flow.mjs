// Ad-hoc Playwright UAT script for Phase 07 — kitchen (KDS) flow.
// Run with: node kitchen-flow.mjs (from frontend/ so @playwright/test resolves)
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
  if (await tenantField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tenantField.fill("demo");
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
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
    log("=== LOGIN as chef@demo.local (KITCHEN_STAFF) ===");
    await login(page, "chef@demo.local", "Chef#2026");
    results.loginUrl = page.url();
    await shot(page, "10-chef-post-login");

    log("=== Check sidebar (Test 10 - chef should see Kitchen Display, NOT POS) ===");
    const sidebarText = await page.locator("body").innerText();
    results.sidebarHasPos = sidebarText.includes("POS");
    results.sidebarHasKitchen = sidebarText.includes("Kitchen Display");

    log("=== Try to access POS directly (should be denied) ===");
    await gotoRobust(page, `${BASE}/app/pos`);
    await shot(page, "11-chef-pos-access-attempt");
    const posBlockedText = await page.locator("text=/do not have permission|not enabled/i").first().isVisible().catch(() => false);
    results.posBlockedForChef = posBlockedText;

    log("=== Navigate to Kitchen Display ===");
    await gotoRobust(page, `${BASE}/app/kitchen`);
    await page.waitForTimeout(2000);
    await shot(page, "12-kds-board-initial");

    const ticketCards = page.locator('[data-testid="kds-ticket-card"]');
    const ticketCount = await ticketCards.count();
    results.ticketCount = ticketCount;

    if (ticketCount > 0) {
      // Target our own freshly-created ticket (green, <10min) — older seed tickets
      // are red+animate-bounce, which makes Playwright's actionability check
      // (element must be visually stable) time out.
      const freshCard = page.locator('[data-testid="kds-ticket-card"]', { hasText: "20260711-0002" }).first();
      const targetCard = (await freshCard.count()) > 0 ? freshCard : ticketCards.first();
      const firstCardText = await targetCard.innerText();
      results.firstTicketText = firstCardText;

      log("=== Bump first item PENDING -> COOKING ===");
      await targetCard.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      const startBtn = targetCard.locator("button", { hasText: /start/i }).first();
      const startVisible = await startBtn.isVisible().catch(() => false);
      results.startButtonVisible = startVisible;
      if (startVisible) {
        await startBtn.click({ force: true, timeout: 5000 });
        await page.waitForTimeout(1500);
        await shot(page, "13-after-bump-to-cooking");
        results.cardTextAfterFirstBump = await targetCard.innerText().catch(() => null);

        log("=== Bump item COOKING -> READY ===");
        const doneBtn = targetCard.locator("button", { hasText: /done/i }).first();
        const doneVisible = await doneBtn.isVisible().catch(() => false);
        results.doneButtonVisible = doneVisible;
        if (doneVisible) {
          await doneBtn.click({ force: true, timeout: 5000 });
          await page.waitForTimeout(1500);
          await shot(page, "14-after-bump-to-ready");
          results.cardTextAfterSecondBump = await targetCard.innerText().catch(() => null);
        }
      }
    }

    // Check dark theme styling
    const bgIsDark = await page.evaluate(() => {
      const body = document.querySelector("body");
      const bg = getComputedStyle(body).backgroundColor;
      return bg;
    });
    results.bodyBackgroundColor = bgIsDark;

    results.consoleErrors = consoleErrors;
  } catch (err) {
    results.fatalError = String(err);
    await shot(page, "99-fatal-error-kitchen");
  }
  results.consoleErrors = results.consoleErrors ?? consoleErrors;

  fs.writeFileSync(
    path.join(SHOT_DIR, "kitchen-flow-results.json"),
    JSON.stringify(results, null, 2)
  );
  log("RESULTS:", JSON.stringify(results, null, 2));

  await browser.close();
}

main();

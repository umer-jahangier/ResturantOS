/*
 * DIAGNOSIS ONLY — capability (e): can features be enabled/disabled, and at what grain?
 *
 * Drives the SuperAdmin feature matrix at /platform/tenants/{id} and actually clicks a
 * Disable button, then reads the row back, then reverts. A matrix that renders is not a
 * matrix that saves.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/rbac-role-builder",
);
const BASE = "http://localhost:3000";
const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8"; // floating-terrace

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const out = {};

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("");
  await page.locator('input[name="email"], input#email').first().fill("superadmin@softxlogic.com");
  await page.locator('input[name="password"], input#password').first().fill("Test@123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  console.log("superadmin →", page.url());

  await page.goto(`${BASE}/platform/tenants/${TENANT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  let body = await page.locator("body").innerText();
  const alerts = (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean);
  if (alerts.length) {
    console.log("ALERTS on first load, retrying:", alerts);
    out.retriedBecauseOfAlert = alerts;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    body = await page.locator("body").innerText();
  }
  await page.screenshot({ path: `${OUT}/superadmin-tenant-detail.png`, fullPage: true });
  out.url = page.url();
  out.is404 = /404|could not be found/i.test(body);
  out.body = body.slice(0, 4000);
  out.hasMatrix = (await page.locator('[data-testid="feature-matrix"]').count()) > 0;
  out.featureRows = await page.locator('[data-testid^="feature-row-"]').count();
  console.log("matrix present:", out.hasMatrix, "rows:", out.featureRows);
  console.log("\n=== TENANT DETAIL BODY ===\n", body.slice(0, 2500));

  // Flip FEATURE_CRM off and read it back.
  const disable = page.locator('[data-testid="feature-disable-FEATURE_CRM"]');
  const enable = page.locator('[data-testid="feature-enable-FEATURE_CRM"]');
  out.crmDisableBtn = await disable.count();
  out.crmEnableBtn = await enable.count();
  if (await disable.count()) {
    const before = await page.locator('[data-testid="feature-row-FEATURE_CRM"]').innerText();
    await disable.first().click();
    await page.waitForTimeout(4000);
    const after = await page.locator('[data-testid="feature-row-FEATURE_CRM"]').innerText();
    out.crmToggle = { before, after, changed: before !== after };
    console.log("\nCRM ROW BEFORE:", before.replace(/\n/g, " | "));
    console.log("CRM ROW AFTER :", after.replace(/\n/g, " | "));
    await page.screenshot({ path: `${OUT}/superadmin-crm-disabled.png`, fullPage: true });

    // reload to prove it PERSISTED, not just re-rendered
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    out.crmAfterReload = await page
      .locator('[data-testid="feature-row-FEATURE_CRM"]')
      .innerText()
      .catch(() => "(row gone)");
    console.log("CRM ROW RELOAD:", out.crmAfterReload.replace(/\n/g, " | "));

    // revert
    const revert = page.locator('[data-testid="feature-revert-FEATURE_CRM"]');
    if (await revert.count()) {
      await revert.first().click();
      await page.waitForTimeout(4000);
      out.reverted = await page.locator('[data-testid="feature-row-FEATURE_CRM"]').innerText();
      console.log("CRM ROW REVERTED:", out.reverted.replace(/\n/g, " | "));
    }
  }

  // Is there anything anywhere on this page about a USER or ROLE grain?
  out.mentionsRole = /role/i.test(body);
  out.mentionsPerUser = /per user|per-user/i.test(body);

  writeFileSync(`${OUT}/feature-findings.json`, JSON.stringify(out, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}
main();

/*
 * DIAGNOSIS ONLY — capability (e), done properly.
 *
 * The first pass reported "Disable does nothing". That was MY bug: `onRequestDisable` opens a
 * type-the-tenant-name confirmation, which the probe never completed. This pass drives the
 * whole flow — Disable → type the name → confirm → read the row back → reload → revert — so the
 * verdict rests on the product's behaviour and not on my clicking.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/rbac-role-builder",
);
const BASE = "http://localhost:3000";
const TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const TENANT_NAME = "Floating Terrace";

const row = (p) => p.locator('[data-testid="feature-row-FEATURE_CRM"]').innerText();

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const out = {};
  page.on("console", (m) => m.type() === "error" && console.log("  console.error:", m.text().slice(0, 160)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("");
  await page.locator('input[name="email"], input#email').first().fill("superadmin@softxlogic.com");
  await page.locator('input[name="password"], input#password').first().fill("Test@123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);

  await page.goto(`${BASE}/platform/tenants/${TENANT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  out.before = await row(page);
  console.log("BEFORE      :", out.before.replace(/\n/g, " | "));

  await page.locator('[data-testid="feature-disable-FEATURE_CRM"]').click();
  await page.waitForTimeout(2000);

  const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
  out.confirmDialog = {
    present: (await dlg.count()) > 0,
    width: (await dlg.first().boundingBox().catch(() => null))?.width,
    text: await dlg
      .first()
      .innerText()
      .catch(() => "(none)"),
  };
  console.log("\nCONFIRM DIALOG width=", out.confirmDialog.width);
  console.log(out.confirmDialog.text);
  await page.screenshot({ path: `${OUT}/feature-confirm-dialog.png`, fullPage: true });

  // type the tenant name, then confirm
  const input = dlg.locator("input").first();
  if (await input.count()) await input.fill(TENANT_NAME);
  await page.waitForTimeout(600);
  const confirmBtn = dlg.locator("button").filter({ hasText: /disable module/i });
  out.confirmEnabled = await confirmBtn.first().isEnabled();
  console.log("confirm button enabled after typing name:", out.confirmEnabled);
  await confirmBtn.first().click();
  await page.waitForTimeout(5000);

  out.after = await row(page).catch(() => "(row gone)");
  console.log("AFTER       :", out.after.replace(/\n/g, " | "));
  await page.screenshot({ path: `${OUT}/feature-crm-disabled.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  out.afterReload = await row(page).catch(() => "(row gone)");
  console.log("AFTER RELOAD:", out.afterReload.replace(/\n/g, " | "));
  out.persisted = /off/i.test(out.afterReload);

  // Does the tenant's own OWNER now lose the Customers nav item? That is the only proof that a
  // platform toggle reaches a real user's screen.
  writeFileSync(`${OUT}/feature-findings2.json`, JSON.stringify(out, null, 2));

  // revert
  const revert = page.locator('[data-testid="feature-revert-FEATURE_CRM"]');
  if (await revert.count()) {
    await revert.first().click();
    await page.waitForTimeout(5000);
    out.reverted = await row(page).catch(() => "?");
    console.log("REVERTED    :", out.reverted.replace(/\n/g, " | "));
  } else {
    const en = page.locator('[data-testid="feature-enable-FEATURE_CRM"]');
    if (await en.count()) {
      await en.first().click();
      await page.waitForTimeout(5000);
      out.reverted = await row(page).catch(() => "?");
      console.log("RE-ENABLED  :", out.reverted.replace(/\n/g, " | "));
    }
  }
  writeFileSync(`${OUT}/feature-findings2.json`, JSON.stringify(out, null, 2));
  await browser.close();
}
main();

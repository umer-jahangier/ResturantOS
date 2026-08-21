/*
 * DIAGNOSIS ONLY — capability (d): assign a role to a user, scoped to a branch, END TO END.
 * Also dumps the full user-detail panel text so (c)/(f) rest on what is on screen.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/rbac-role-builder",
);
const BASE = "http://localhost:3000";
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, v = 0;
  const o = [];
  for (const c of input.toUpperCase()) {
    const i = a.indexOf(c);
    if (i === -1) continue;
    v = (v << 5) | i; bits += 5;
    if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(o);
}
function totp(s) {
  const c = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", b32(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  return String(((((h[o] & 0x7f) << 24) | (h[o+1] << 16) | (h[o+2] << 8) | h[o+3]) >>> 0) % 1e6).padStart(6, "0");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const out = {};

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(OWNER.slug);
  await page.locator('input#email, input[name="email"]').first().fill(OWNER.email);
  await page.locator('input#password, input[name="password"]').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) {
    await t.first().fill(totp(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  console.log("owner →", page.url());

  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // pick the waiter — a low-privilege account safe to re-role and put back
  await page.locator("button").filter({ hasText: "waiter@terrace.local" }).first().click();
  await page.waitForTimeout(4000);
  const panelBefore = await page.locator("body").innerText();
  const idx = panelBefore.indexOf("Roles by branch");
  out.detailPanel = panelBefore.slice(Math.max(0, idx - 700), idx + 1600);
  console.log("\n=== USER DETAIL PANEL (waiter) ===\n" + out.detailPanel);
  await page.screenshot({ path: `${OUT}/detail-waiter-before.png`, fullPage: true });

  // Does the panel state the user's effective PERMISSIONS anywhere?
  out.panelNamesPermissionCodes = /pos\.order|rbac\.|finance\./.test(panelBefore);
  out.panelSaysPermission = /permission/i.test(out.detailPanel);

  // --- assign Cashier on the Rooftop branch ---
  await page.locator("button").filter({ hasText: /assign role/i }).first().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"]');
  const selects = dlg.locator("select");
  await selects.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
  await page.waitForTimeout(500);
  await selects.nth(1).selectOption({ label: "Cashier" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/assign-filled.png`, fullPage: true });
  await dlg.locator("button").filter({ hasText: /^Assign role$/ }).first().click();
  await page.waitForTimeout(5000);

  const bodyAfter = await page.locator("body").innerText();
  const i2 = bodyAfter.indexOf("Roles by branch");
  out.detailAfter = bodyAfter.slice(Math.max(0, i2 - 400), i2 + 1200);
  out.dialogStillOpen = (await page.locator('[role="dialog"]').count()) > 0;
  console.log("\n=== AFTER ASSIGN ===\n" + out.detailAfter);
  await page.screenshot({ path: `${OUT}/detail-waiter-after-assign.png`, fullPage: true });

  // reload — did it persist?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.locator("button").filter({ hasText: "waiter@terrace.local" }).first().click();
  await page.waitForTimeout(4000);
  const reloaded = await page.locator("body").innerText();
  const i3 = reloaded.indexOf("Roles by branch");
  out.afterReload = reloaded.slice(Math.max(0, i3 - 200), i3 + 900);
  out.persisted = /Cashier/.test(out.afterReload);
  console.log("\n=== AFTER RELOAD (persisted:", out.persisted, ") ===\n" + out.afterReload);
  await page.screenshot({ path: `${OUT}/detail-waiter-after-reload.png`, fullPage: true });

  writeFileSync(`${OUT}/assign-e2e.json`, JSON.stringify(out, null, 2));
  await browser.close();
}
main();

/*
 * DIAGNOSIS ONLY — does a routine UI edit of a menu item destroy its tax configuration?
 *
 * The item "Audit Item 52235" (an existing throwaway row named "gap audit") has been given
 * taxRatePct=17.0 and taxRateCode="SR-STD-17" through the admin API. This script edits that
 * item in the browser the way an owner would — open the row, change the description, save —
 * and the caller then re-reads the item through the API.
 *
 * The UI form has no tax controls, and `UpdateMenuItemRequest.taxRateCode` documents null as
 * "REMOVE, not unchanged", so the hypothesis is that saving a name/price edit silently erases
 * the fiscal tax code.
 *
 * Run: node e2e/diag/tax-wipe-probe.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/tax-config");
const BASE = "http://localhost:3000";
const TARGET = "Audit Item 52235";

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // Capture exactly what the browser PUTs, so the claim rests on the wire, not on inference.
  const sent = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/pos/menu/items/")) {
      sent.push({ url: r.url(), body: r.postData() });
    }
  });

  if (!(await login(page))) { console.log("LOGIN FAILED"); await browser.close(); process.exit(1); }

  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) { await login(page); await page.goto(`${BASE}/app/menu/items`); await page.waitForTimeout(6000); }

  // The list is a card/row layout, not a table: each item exposes an "Actions for <name>" menu.
  const actions = page.locator(`[aria-label="Actions for ${TARGET}"]`).first();
  console.log("actions menu found:", await actions.count());
  await actions.click();
  await page.waitForTimeout(1200);
  const menuItems = await page.locator('[role="menuitem"]').allInnerTexts();
  console.log("actions menu offers:", JSON.stringify(menuItems));
  await page.locator('[role="menuitem"]:has-text("Edit")').first().click();
  await page.waitForTimeout(2500);

  const dialog = page.locator('[role="dialog"]').first();
  const labels = await dialog.locator("label").allInnerTexts();
  console.log("edit-dialog labels:", JSON.stringify(labels));
  await page.screenshot({ path: `${OUT}/wipe-edit-dialog.png`, fullPage: true });

  // The most innocuous edit an owner could make.
  const desc = dialog.locator('textarea[name="description"], input[name="description"]').first();
  if (await desc.count()) { await desc.fill("gap audit (description touched by tax audit)"); }

  await dialog.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/wipe-after-save.png`, fullPage: true });

  console.log("PUT requests the browser sent:");
  for (const s of sent) console.log("  ", s.url, "\n   body:", s.body);

  await browser.close();
}
main();

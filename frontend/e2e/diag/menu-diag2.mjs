/*
 * DIAGNOSIS part 2 — does the picture reach the POS? does 86-ing propagate?
 * are there variants / modifiers / channel prices / branch overrides / bulk import anywhere?
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-management";
const BASE = "http://localhost:3000";
const ITEM = process.argv[2] || "Diag Karahi 785508";

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

function base32Decode(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) { const i = A.indexOf(c); if (i === -1) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function totpNow(s) {
  const c = Math.floor(Date.now() / 1000 / 30); const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", base32Decode(s)).update(b).digest(); const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1e6).padStart(6, "0");
}
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"]').first().fill(OWNER.email);
  await page.locator('input[name="password"]').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) { await t.first().fill(totpNow(OWNER.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4500); }
  return !page.url().includes("/login");
}
async function shot(page, n) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n + ".png"); }

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const net = [];
  page.on("response", (r) => { if (r.status() >= 400 && /\/api\//.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`); });
  if (!(await login(page))) { say("FATAL login"); await browser.close(); return; }
  say("owner signed in. target item = " + ITEM);

  // ---- POS ----
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await shot(page, "20-pos-landing");
  say("POS URL: " + page.url());
  const posBody = await page.locator("body").innerText();
  say("POS BODY (first 60 lines):\n" + posBody.split("\n").slice(0, 60).map(l => "    " + l).join("\n"));

  // If there is a "New order" / start button, click it
  for (const label of [/New order/i, /Start order/i, /New Order/i, /Take order/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.count()) { say("  clicking " + label); await b.click(); await page.waitForTimeout(6000); break; }
    const l = page.getByRole("link", { name: label }).first();
    if (await l.count()) { say("  clicking link " + label); await l.click(); await page.waitForTimeout(6000); break; }
  }
  await shot(page, "21-pos-order-screen");
  say("POS after start URL: " + page.url());
  const grid = await page.locator("body").innerText();
  say("  order screen shows target item = " + grid.includes(ITEM));
  const imgs = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("img"));
    return { count: a.length, srcs: a.slice(0, 10).map(i => (i.getAttribute("src") || "").slice(0, 60)) };
  });
  say("  <img> on the POS order grid = " + JSON.stringify(imgs));
  say("  POS BODY:\n" + grid.split("\n").slice(0, 90).map(l => "    " + l).join("\n"));

  // Tap the target item — is there a modifier picker / variant chooser / notes?
  const tile = page.getByText(ITEM, { exact: false }).first();
  if (await tile.count()) {
    await tile.click(); await page.waitForTimeout(3000);
    await shot(page, "22-pos-item-tapped");
    say("  dialogs after tap = " + await page.locator('[role="dialog"]').count());
    const after = await page.locator("body").innerText();
    say("  page mentions 'Modifier'/'Options'/'Size' = " + /modifier|add-on|options|size|variant/i.test(after));
  } else {
    say("  ! target item not tappable on the POS grid");
  }

  // ---- 86 the item, then check POS again ----
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  const act = page.getByRole("button", { name: new RegExp(`Actions for ${ITEM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first();
  if (await act.count()) {
    await act.click(); await page.waitForTimeout(1200);
    await shot(page, "23-item-actions-menu");
    const menuTxt = await page.locator('[role="menu"]').innerText().catch(() => "(none)");
    say("  ITEM ACTIONS MENU: " + JSON.stringify(menuTxt));
    const de = page.getByRole("menuitem", { name: /Deactivate/i }).first();
    if (await de.count()) {
      await de.click(); await page.waitForTimeout(5000);
      say("  deactivated. toast=" + JSON.stringify(await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])));
      await shot(page, "24-after-86");
    }
  } else say("  ! no actions button for the item");

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(7000);
  for (const label of [/New order/i, /Start order/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(6000); break; }
  }
  const after86 = await page.locator("body").innerText();
  say("  AFTER 86: POS still shows the item = " + after86.includes(ITEM));
  await shot(page, "25-pos-after-86");

  // ---- Branch override / per-branch menu ----
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  const edit = page.getByRole("button", { name: /Actions for Chicken Karahi/ }).first();
  if (await edit.count()) {
    await edit.click(); await page.waitForTimeout(1000);
    await page.getByRole("menuitem", { name: /^Edit$/ }).first().click(); await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').first();
    say("  EDIT DIALOG full text:\n" + (await d.innerText()).split("\n").map(l => "    " + l).join("\n"));
    await shot(page, "26-edit-item-dialog");
    await page.keyboard.press("Escape");
  }

  // ---- Category actions: is there per-channel visibility / subcategory / display order? ----
  const catAct = page.getByRole("button", { name: /Actions for Starters/ }).first();
  if (await catAct.count()) {
    await catAct.click(); await page.waitForTimeout(1000);
    await page.getByRole("menuitem", { name: /^Edit$/ }).first().click(); await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').first();
    say("  CATEGORY EDIT DIALOG:\n" + (await d.innerText()).split("\n").map(l => "    " + l).join("\n"));
    await shot(page, "27-edit-category-dialog");
    await page.keyboard.press("Escape");
  }

  // ---- Recipes ----
  await page.goto(`${BASE}/app/inventory/recipes`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(7000);
  await shot(page, "28-recipes");
  const rb = await page.locator("body").innerText();
  say("RECIPES PAGE:\n" + rb.split("\n").slice(28, 100).map(l => "    " + l).join("\n"));

  // open the first recipe if any
  const firstRow = page.getByRole("link").filter({ hasNotText: /Dashboard|POS|Kitchen|Till|Inventory|Menu|Tables|Stations|Guide|Takings|Accounts|Journal|General|Periods|Expenses|AP|Purchasing|HR|Customers|Reports|Realtime|Ask|Appearance|Users|General/ }).first();
  const anyRecipeBtn = page.getByRole("button", { name: /Write a recipe|New recipe|Add recipe|Create/i }).first();
  if (await anyRecipeBtn.count()) {
    await anyRecipeBtn.click(); await page.waitForTimeout(3000);
    await shot(page, "29-recipe-dialog");
    const d = page.locator('[role="dialog"]').first();
    if (await d.count()) say("  RECIPE DIALOG:\n" + (await d.innerText()).split("\n").map(l => "    " + l).join("\n"));
    await page.keyboard.press("Escape");
  }

  say("\nAPI 4xx/5xx:"); for (const n of net) say("  " + n);
  writeFileSync(`${OUT}/RUN-LOG-2.txt`, log.join("\n"));
  await browser.close();
}
main();

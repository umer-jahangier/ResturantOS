/*
 * DIAGNOSIS ONLY — menu / products / images / modifiers / recipes.
 * Signs in as OWNER (holds every permission) so an "Access denied" cannot be mistaken
 * for a missing feature. Asserts a non-error precondition before every shot.
 *
 * node e2e/diag/menu-diag.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-management";
const BASE = "http://localhost:3000";
const IMG = "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad/karahi.png";
const STAMP = Date.now().toString().slice(-6);

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

const log = [];
function say(...a) {
  const s = a.join(" ");
  console.log(s);
  log.push(s);
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
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

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  say("  shot:", `${name}.png`);
}

/** Go to a route; retry once if it renders an error/alert. Reports honestly. */
async function goSafe(page, route, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').count();
    const alertTxt = await page.locator('[role="alert"]').allInnerTexts().catch(()=>[]);
    const realAlerts = alertTxt.filter(t=>t.trim().length>0);
    const bad = /Couldn.t load|Access denied|You do not have permission|Something went wrong|Unexpected error/i.test(body);
    if (!bad && realAlerts.length === 0) return { ok: true, body };
    say(`  [${label}] attempt ${attempt}: ERROR-ISH page (alerts=${JSON.stringify(realAlerts).slice(0,200)}) — retrying`);
    if (attempt === 2) {
      await shot(page, `ERROR-${label}`);
      return { ok: false, body };
    }
    await page.waitForTimeout(2500);
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const netFails = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) netFails.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on("pageerror", (e) => say("  ! pageerror:", String(e).slice(0, 200)));

  if (!(await login(page))) { say("FATAL: owner login failed, url=" + page.url()); await shot(page, "FATAL-login"); await browser.close(); return; }
  say("signed in as owner@terrace.local");

  // ---------- 0. What does the sidebar offer under Menu? ----------
  await goSafe(page, "/app/dashboard", "dashboard");
  const navText = await page.locator("nav, aside").first().innerText().catch(() => "(no nav)");
  say("SIDEBAR NAV:\n" + navText.split("\n").map((l) => "    " + l).join("\n"));
  await shot(page, "00-sidebar-owner");

  // ---------- 1. Menu Items page ----------
  const menuPage = await goSafe(page, "/app/menu/items", "menu-items");
  say("MENU ITEMS PAGE ok=" + menuPage.ok);
  say("  body head:\n" + menuPage.body.split("\n").slice(0, 25).map((l) => "    " + l).join("\n"));
  await shot(page, "01-menu-items-list");

  // ---------- 2. Create a CATEGORY ----------
  const catName = `Diag Cat ${STAMP}`;
  await page.getByRole("button", { name: "Add category" }).first().click();
  await page.waitForTimeout(1200);
  const dlg = page.locator('[role="dialog"]').first();
  const box = await dlg.boundingBox().catch(() => null);
  say(`  CATEGORY DIALOG box = ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "NOT RENDERED"}`);
  await shot(page, "02-category-dialog");
  const catFields = await dlg.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("name") || e.getAttribute("aria-label") || e.id || "?"}] type=${e.getAttribute("type") || ""}`));
  say("  CATEGORY DIALOG FIELDS: " + JSON.stringify(catFields));
  const nameIn = dlg.locator('input[name="name"], input#name').first();
  await nameIn.fill(catName);
  await dlg.getByRole("button", { name: /Add category|Save|Create/i }).last().click();
  await page.waitForTimeout(9000);
  say("  toast after category save: " + JSON.stringify(await page.locator("[data-sonner-toast], li[role]").allInnerTexts().catch(() => [])));
  const afterCat = await page.locator("body").innerText();
  say("  CATEGORY CREATED? body contains name = " + afterCat.includes(catName));
  await shot(page, "03-after-category-create");

  // ---------- 3. Create an ITEM with an IMAGE ----------
  const itemName = `Diag Karahi ${STAMP}`;
  // click "Add item" inside our new category group
  const group = page.locator(`[role="group"][aria-label*="${catName}"]`).first();
  if (await group.count()) {
    await group.getByRole("button", { name: /^Add item$/i }).first().click();
  } else {
    say("  ! could not find the new category group; using top-level Add item");
    await page.getByRole("button", { name: /^Add item$/i }).first().click();
  }
  await page.waitForTimeout(1500);
  const idlg = page.locator('[role="dialog"]').first();
  const ibox = await idlg.boundingBox().catch(() => null);
  say(`  ITEM DIALOG box = ${ibox ? `${Math.round(ibox.width)}x${Math.round(ibox.height)}` : "NOT RENDERED"}`);
  const itemFields = await idlg.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("name") || e.getAttribute("aria-label") || e.id || "?"}] type=${e.getAttribute("type") || ""}`));
  say("  ITEM DIALOG FIELDS: " + JSON.stringify(itemFields));
  say("  ITEM DIALOG TEXT:\n" + (await idlg.innerText()).split("\n").map((l) => "    " + l).join("\n"));
  await shot(page, "04-item-dialog-empty");

  // pick our new category if the select didn't preselect
  const sel = idlg.locator("select").first();
  if (await sel.count()) {
    const opts = await sel.locator("option").evaluateAll((o) => o.map((x) => `${x.textContent}|${x.value}`));
    const mine = opts.find((o) => o.startsWith(catName));
    if (mine) await sel.selectOption(mine.split("|")[1]);
    else say("  ! new category NOT in the item dialog's category dropdown. options=" + JSON.stringify(opts.slice(0, 10)));
  }
  await idlg.locator('input[name="name"]').first().fill(itemName);
  await idlg.locator('input[name="priceRupees"]').first().fill("777");

  const fileIn = idlg.locator('input[type="file"]');
  say("  FILE INPUT PRESENT: " + (await fileIn.count()));
  if (await fileIn.count()) {
    await fileIn.first().setInputFiles(IMG);
    await page.waitForTimeout(6000);
    await shot(page, "05-item-dialog-after-upload");
    const dt = await idlg.innerText();
    say("  AFTER UPLOAD dialog text:\n" + dt.split("\n").map((l) => "    " + l).join("\n"));
    const previewCount = await idlg.locator("img").count();
    say("  PREVIEW <img> count in dialog = " + previewCount);
  }

  await idlg.getByRole("button", { name: /^Add item$/i }).last().click();
  await page.waitForTimeout(5000);
  await shot(page, "06-after-item-create");
  const afterItem = await page.locator("body").innerText();
  say("  ITEM CREATED? list contains name = " + afterItem.includes(itemName));

  // ---------- 4. Does the thumbnail actually render in the list? ----------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const row = page.locator("div").filter({ hasText: new RegExp(itemName) }).last();
  const imgInfo = await page.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll("div")).filter(
      (d) => d.children.length && d.textContent?.includes(name) && d.querySelector("img,svg"));
    const r = rows[rows.length - 1];
    if (!r) return "row not found";
    const img = r.querySelector("img");
    if (!img) return "NO <img> in the row (placeholder/svg only)";
    return `img src=${(img.getAttribute("src") || "").slice(0, 60)} naturalW=${img.naturalWidth} naturalH=${img.naturalHeight} complete=${img.complete}`;
  }, itemName);
  say("  LIST THUMBNAIL: " + imgInfo);
  await shot(page, "07-list-with-thumbnail");

  // ---------- 5. Does the image show in the POS terminal? ----------
  const pos = await goSafe(page, "/app/pos/terminal", "pos-terminal");
  say("POS TERMINAL ok=" + pos.ok);
  await shot(page, "08-pos-terminal");
  const posImgs = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return { total: imgs.length, srcs: imgs.slice(0, 8).map((i) => (i.getAttribute("src") || "").slice(0, 70)) };
  });
  say("  POS <img> tags on the order grid: " + JSON.stringify(posImgs));
  const posHasItem = (await page.locator("body").innerText()).includes(itemName);
  say("  POS grid shows the new item = " + posHasItem);
  // search for it
  const search = page.locator('input[type="search"], input[placeholder*="earch"]').first();
  if (await search.count()) {
    await search.fill(itemName.split(" ")[1]);
    await page.waitForTimeout(2500);
    await shot(page, "09-pos-search-item");
    say("  after POS search, item visible = " + (await page.locator("body").innerText()).includes(itemName));
    const afterSearchImgs = await page.evaluate(() => document.querySelectorAll("img").length);
    say("  <img> count after search = " + afterSearchImgs);
  } else {
    say("  ! no search box on the POS terminal");
  }
  // Is there any modifier UI when tapping an item?
  const tile = page.getByRole("button", { name: new RegExp(itemName.split(" ")[1]) }).first();
  if (await tile.count()) {
    await tile.click();
    await page.waitForTimeout(2500);
    await shot(page, "10-pos-after-item-tap");
    const modalCount = await page.locator('[role="dialog"]').count();
    say("  after tapping the item, dialogs open = " + modalCount + " (a modifier picker would be one)");
  }

  // ---------- 6. Recipes ----------
  const rec = await goSafe(page, "/app/inventory/recipes", "recipes");
  say("RECIPES ok=" + rec.ok);
  say("  recipes body head:\n" + rec.body.split("\n").slice(0, 20).map((l) => "    " + l).join("\n"));
  await shot(page, "11-recipes-list");

  // ---------- 7. Hunt for anything else: modifiers/variants/pricing/import ----------
  for (const [label, route] of [
    ["modifiers", "/app/menu/modifiers"],
    ["variants", "/app/menu/variants"],
    ["pricing", "/app/menu/pricing"],
    ["import", "/app/menu/import"],
    ["menu-root", "/app/menu"],
    ["combos", "/app/menu/combos"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const t = (await page.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\n/g, " | ");
    say(`  ROUTE ${route} -> "${t}"`);
  }

  say("\nAPI 4xx/5xx seen during the run:");
  for (const f of netFails) say("  " + f);

  writeFileSync(`${OUT}/RUN-LOG.txt`, log.join("\n"));
  await browser.close();
}
main();

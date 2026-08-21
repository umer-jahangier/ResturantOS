/*
 * DIAGNOSIS part 3 — reach the REAL POS order grid (needs an open till) and answer:
 *   does a menu-item photo appear at the till? is there any modifier/variant picker?
 * Runs as CASHIER, the persona who actually rings orders.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-management";
const BASE = "http://localhost:3000";
const PHOTO_ITEM = process.argv[2] || "Photo Dish 50585";

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
async function shot(page, n) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n + ".png"); }

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"]').first().fill(who.email);
  await page.locator('input[name="password"]').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const net = [];
  page.on("response", (r) => { if (r.status() >= 400 && /\/api\//.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 130)}`); });

  if (!(await login(page, CASHIER))) { say("FATAL cashier login, url=" + page.url()); await shot(page, "FATAL-cashier"); await browser.close(); return; }
  say("signed in as cashier@terrace.local");

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(8000);
  await shot(page, "30-cashier-pos");
  let body = await page.locator("body").innerText();
  say("POS state: " + (body.includes("Your till is closed") ? "TILL CLOSED" : "till appears open"));

  if (body.includes("No active till") || body.includes("Your till is closed")) {
    const ot = page.getByRole("button", { name: /Open Till/i }).first();
    if (await ot.count()) {
      await ot.click(); await page.waitForTimeout(2500);
      const d = page.locator('[role="dialog"]').first();
      say("  OPEN TILL DIALOG:\n" + (await d.innerText().catch(() => "(none)")).split("\n").map(l => "    " + l).join("\n"));
      const num = d.locator('input[type="number"], input[inputmode="decimal"], input[name*="loat"], input[name*="mount"]').first();
      if (await num.count()) await num.fill("5000");
      else { const anyIn = d.locator("input").first(); if (await anyIn.count()) await anyIn.fill("5000"); }
      await d.getByRole("button", { name: /Open|Confirm|Save/i }).last().click();
      await page.waitForTimeout(7000);
      await shot(page, "31-after-open-till");
    }
  }

  await page.waitForTimeout(4000);
  body = await page.locator("body").innerText();
  await shot(page, "32-pos-terminal-grid");
  say("POS grid now shows a menu? mentions Starters/Mains = " + /Starters|Mains|Drinks/.test(body));
  say("POS BODY (content region):\n" + body.split("\n").slice(50, 160).map(l => "    " + l).join("\n"));

  const imgs = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("img"));
    return { count: a.length, info: a.slice(0, 12).map(i => ({ src: (i.getAttribute("src") || "").slice(0, 55), w: i.naturalWidth, alt: (i.getAttribute("alt") || "").slice(0, 30) })) };
  });
  say("  <img> ON THE POS ORDER GRID = " + JSON.stringify(imgs));
  say("  POS grid shows the photo item '" + PHOTO_ITEM + "' = " + body.includes(PHOTO_ITEM));

  // tap the photo item and look for a modifier picker
  const tile = page.getByText(PHOTO_ITEM, { exact: false }).first();
  if (await tile.count()) {
    await tile.click(); await page.waitForTimeout(3500);
    await shot(page, "33-pos-item-tapped");
    const dlgs = await page.locator('[role="dialog"]').count();
    say("  after tapping '" + PHOTO_ITEM + "': dialogs=" + dlgs);
    const b2 = await page.locator("body").innerText();
    say("  cart/panel text:\n" + b2.split("\n").slice(-45).map(l => "    " + l).join("\n"));
    say("  any modifier/variant/size/notes affordance = " + /modifier|add-?on|choose|option|size|half|full|variant|special instruction|note/i.test(b2));
    // look for a per-line edit affordance
    const lineBtns = await page.locator('[data-testid*="line"], button[aria-label*="line"], button[aria-label*="Edit"]').count();
    say("  per-line edit buttons = " + lineBtns);
  } else {
    say("  ! photo item not present on the cashier's grid");
  }
  await shot(page, "34-pos-cart");

  say("\nAPI 4xx/5xx:"); for (const n of net) say("  " + n);
  writeFileSync(`${OUT}/RUN-LOG-3.txt`, log.join("\n"));
  await browser.close();
}
main();

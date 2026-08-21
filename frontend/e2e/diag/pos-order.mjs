// Full POS order lifecycle as a CASHIER. Careful, name-based clicking.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = []; const net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-2.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));

async function shot(page, n) { await page.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n); }
async function panel(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const send = btns.find(b => /Send to Kitchen/i.test(b.innerText));
    const root = send ? send.closest("div.w-80") || send.parentElement.parentElement : null;
    return { text: root ? root.innerText : "(panel not found)" };
  });
}
async function login(page, c) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (c.slug && await s.count()) await s.first().fill(c.slug);
  await page.locator('input[name="email"], input#email').first().fill(c.email);
  await page.locator('input[name="password"], input#password').first().fill(c.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => say("  ! pageerror:", String(e).slice(0, 200)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });

  if (!await login(page, CASHIER)) { say("LOGIN FAILED"); dump(); await browser.close(); return; }
  say("signed in cashier");

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);

  // Add Chicken Karahi x1 by exact tile name
  const tile = page.locator('[data-testid="menu-grid"] button', { hasText: "Chicken Karahi" }).first();
  await tile.click(); await page.waitForTimeout(800);
  say("A) after 1 tap on Chicken Karahi, PANEL >>>\n" + (await panel(page)).text + "\n<<<");
  await tile.click(); await page.waitForTimeout(600);          // qty 2
  const tile2 = page.locator('[data-testid="menu-grid"] button', { hasText: "Butter Naan" }).first();
  await tile2.click(); await page.waitForTimeout(800);
  say("B) cart = Karahi x2 + Naan x1, PANEL >>>\n" + (await panel(page)).text + "\n<<<");
  await shot(page, "10-cart-built");

  // Is there ANY per-line control: note, modifier, seat, course, discount?
  const lineControls = await page.evaluate(() => {
    const send = Array.from(document.querySelectorAll("button")).find(b => /Send to Kitchen/i.test(b.innerText));
    const root = send ? send.closest("div.w-80") : null;
    if (!root) return null;
    return Array.from(root.querySelectorAll("button")).map(b => (b.innerText || b.getAttribute("aria-label") || "").trim());
  });
  say("ORDER PANEL CONTROLS:", JSON.stringify(lineControls));

  // table selector contents (dine-in)
  const tableSel = page.locator('button', { hasText: /No table|Table/ }).first();
  if (await tableSel.count()) {
    await tableSel.click(); await page.waitForTimeout(1200);
    await shot(page, "11-table-picker");
    const opts = await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"],[role="dialog"],[cmdk-list]');
      return lb ? lb.innerText.slice(0, 1200) : null;
    });
    say("TABLE PICKER:", JSON.stringify(opts));
    // choose first table
    const opt = page.locator('[role="option"]').first();
    if (await opt.count()) { await opt.click(); await page.waitForTimeout(800); say("picked table"); }
    else { await page.keyboard.press("Escape"); }
  }
  say("C) PANEL after table >>>\n" + (await panel(page)).text + "\n<<<");
  await shot(page, "12-table-selected");

  // ---- SEND TO KITCHEN
  await page.locator("button", { hasText: /^Send to Kitchen$/ }).first().click();
  await page.waitForTimeout(7000);
  say("D) after SEND, PANEL >>>\n" + (await panel(page)).text + "\n<<<");
  await shot(page, "13-after-send");
  say("URL:", page.url());

  // Now what controls exist post-send?
  const postSend = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map(b => (b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean));
  say("POST-SEND BUTTONS:", JSON.stringify(postSend));

  // ---- ORDER MANAGEMENT tab
  await page.locator("button,a", { hasText: /Order Management/ }).first().click();
  await page.waitForTimeout(5000);
  await shot(page, "14-order-management");
  const omText = await page.locator("main").innerText().catch(async () => page.locator("body").innerText());
  say("ORDER MGMT >>>\n" + omText.slice(0, 3000) + "\n<<<");
  const omButtons = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean));
  say("ORDER MGMT BUTTONS:", JSON.stringify(omButtons));

  // open the first order row -> drawer
  const row = page.locator("table tbody tr").first();
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(3500);
    await shot(page, "15-order-drawer");
    const drawer = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null; const r = d.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.slice(0, 2500),
        buttons: Array.from(d.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean) };
    });
    say("ORDER DRAWER:", JSON.stringify(drawer, null, 1));
  } else say("!! no order rows");

  // ---- FLOOR VIEW
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(4000);
  await page.locator("button,a", { hasText: /Floor View/ }).first().click(); await page.waitForTimeout(4000);
  await shot(page, "16-floor-view");
  say("FLOOR VIEW >>>\n" + (await page.locator("body").innerText()).slice(0, 2000) + "\n<<<");

  dump();
  await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });

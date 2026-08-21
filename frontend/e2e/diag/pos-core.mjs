// POS core lifecycle diagnosis — drives the real app as a CASHIER in Chromium.
// Read-only diagnosis: it takes an order because that is the job, but changes no code.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const log = [];
function say(...a) { const s = a.join(" "); console.log(s); log.push(s); }

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  say("  shot:", name);
}

/** Trap guard: never audit a page that is showing an error state. Retry once. */
async function guard(page, name) {
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  const body = await page.locator("body").innerText().catch(() => "");
  const bad = alerts.filter(t => t.trim()) .concat(
    /Couldn't load|Access denied|Something went wrong|Failed to load/i.test(body)
      ? [body.match(/Couldn't load[^\n]*|Access denied[^\n]*|Something went wrong[^\n]*|Failed to load[^\n]*/i)[0]] : []);
  if (bad.length) { say(`  !! ERROR STATE on ${name}: ${JSON.stringify(bad).slice(0,300)}`); return false; }
  return true;
}

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await slugField.count())) await slugField.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

const net = [];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => say("  ! pageerror:", String(e).slice(0, 200)));
  page.on("response", r => { if (r.url().includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:8080','')}`); });

  const ok = await login(page, CASHIER);
  say(ok ? `SIGNED IN as cashier -> ${page.url()}` : `LOGIN FAILED -> ${page.url()}`);
  if (!ok) { await shot(page, "00-login-failed"); await browser.close(); return; }
  await shot(page, "01-after-login");

  // ---- Sidebar: what can a cashier even reach?
  const nav = await page.locator("nav").allInnerTexts().catch(() => []);
  say("NAV:", JSON.stringify(nav).slice(0, 1200));

  // ---- POS terminal
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await guard(page, "/app/pos");
  await shot(page, "02-pos-terminal");
  const posText = await page.locator("body").innerText();
  say("POS PAGE TEXT >>>\n" + posText.slice(0, 2500) + "\n<<<");

  // (c) IMAGES in the product grid — count <img> and background-images inside the grid
  const gridInfo = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="menu-grid"]');
    if (!grid) return { found: false };
    const tiles = grid.children.length;
    const imgs = grid.querySelectorAll("img").length;
    const svgs = grid.querySelectorAll("svg").length;
    const bg = Array.from(grid.querySelectorAll("*")).filter(el => {
      const b = getComputedStyle(el).backgroundImage; return b && b !== "none";
    }).length;
    const first = grid.children[0] ? grid.children[0].innerText : null;
    const firstHtml = grid.children[0] ? grid.children[0].outerHTML.slice(0, 600) : null;
    return { found: true, tiles, imgs, svgs, bgImages: bg, first, firstHtml };
  });
  say("MENU GRID IMAGE PROBE:", JSON.stringify(gridInfo, null, 1));

  // (b) Order types offered
  const orderTypes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="radio"],[data-testid^="order-type-"]')).map(e => e.textContent.trim()));
  say("ORDER TYPES OFFERED:", JSON.stringify(orderTypes));

  // Every button on the POS screen — this is the honest capability surface
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map(b => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean));
  say("POS BUTTONS:", JSON.stringify(buttons));

  // ---- Take a real order: tap the first menu item
  const firstTile = page.locator('[data-testid="menu-grid"] button').first();
  if (await firstTile.count()) {
    const label = await firstTile.innerText();
    await firstTile.click();
    await page.waitForTimeout(600);
    say("TAPPED ITEM:", label.replace(/\n/g, " | "));
    await shot(page, "03-item-in-cart");
    // did a modifier dialog appear?
    const dlg = await page.locator('[role="dialog"]').count();
    say("MODIFIER DIALOG AFTER TAP? dialogs=", String(dlg));
    // add a second item
    const tiles = page.locator('[data-testid="menu-grid"] > div > button');
    const n = await tiles.count();
    if (n > 1) { await tiles.nth(1).click(); await page.waitForTimeout(500); }
    await shot(page, "04-cart-two-items");
    const cartText = await page.locator("body").innerText();
    say("CART PANEL TEXT >>>\n" + cartText.slice(0, 2500) + "\n<<<");
  } else {
    say("!! NO MENU TILES RENDERED");
  }

  // (h) customer attach
  const custProbe = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button,input")).find(e =>
      /customer/i.test(e.innerText || e.placeholder || e.getAttribute("aria-label") || ""));
    return el ? { tag: el.tagName, text: (el.innerText || el.placeholder || "").trim() } : null;
  });
  say("CUSTOMER CONTROL:", JSON.stringify(custProbe));

  // Try the dialog width trap: open customer picker
  if (custProbe) {
    const cbtn = page.locator("button", { hasText: /customer/i }).first();
    if (await cbtn.count()) {
      await cbtn.click().catch(()=>{});
      await page.waitForTimeout(1500);
      await shot(page, "05-customer-picker");
      const dims = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return null; const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.slice(0,400) };
      });
      say("CUSTOMER DIALOG DIMS:", JSON.stringify(dims));
      await page.keyboard.press("Escape").catch(()=>{});
      await page.waitForTimeout(500);
    }
  }

  writeFileSync(`${OUT}/network.log`, net.join("\n"));
  writeFileSync(`${OUT}/run-1.log`, log.join("\n"));
  await ctx.storageState({ path: `${OUT}/cashier-state.json` });
  await browser.close();
  say("done");
  writeFileSync(`${OUT}/run-1.log`, log.join("\n"));
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/run-1.log`, log.join("\n") + "\nFATAL " + e); });

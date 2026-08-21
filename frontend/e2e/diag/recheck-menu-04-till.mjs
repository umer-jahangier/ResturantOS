// RECHECK — the till half. Images in POS, modifier UI on tap, tax on the cart line,
// and how many items the grid will actually show.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("   shot", n); };

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace"); else log("   !! no tenantSlug field");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  log("   login ->", page.url());
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const seen = [];
  page.on("response", (r) => { if (r.url().includes("/api/v1/pos/menu/items")) seen.push(`${r.status()} ${r.url().replace("http://localhost:8080", "")}`); });

  if (!(await login(page, "cashier@terrace.local", "Terrace#Cashier1"))) { log("LOGIN FAILED"); await browser.close(); return; }

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await shot(page, "R30-pos-landing");
  let body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 700));
  log("1. POS landing:", body);

  // Open a till if closed
  const openBtn = page.getByRole("button", { name: /Open till|Open Till|Start shift/i });
  if (await openBtn.count()) {
    log("2. till closed — opening");
    await openBtn.first().click();
    await page.waitForTimeout(2000);
    const amt = page.locator('[role="dialog"] input');
    if (await amt.count()) { await amt.first().fill("5000"); }
    await shot(page, "R31-open-till-dialog");
    await page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Open")').last().click();
    await page.waitForTimeout(4000);
  } else { log("2. no Open-till button — till presumably already open"); }
  await shot(page, "R32-pos-after-till");
  body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500));
  log("2b. after till:", body);

  // Get to the order grid
  const grid = page.locator('[data-testid="menu-grid"]');
  if (!(await grid.count())) {
    for (const label of [/New Order/i, /Terminal/i, /POS Terminal/i, /Order/i]) {
      const b = page.getByRole("tab", { name: label }).or(page.getByRole("button", { name: label }));
      if (await b.count()) { await b.first().click(); await page.waitForTimeout(3000); if (await grid.count()) break; }
    }
  }
  log("3. menu-grid present:", await grid.count());
  await shot(page, "R33-pos-grid");

  const gridState = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="menu-grid"]');
    return {
      tiles: g ? g.querySelectorAll("button[aria-pressed]").length : 0,
      imgsInGrid: g ? g.querySelectorAll("img").length : 0,
      imgsOnPage: document.querySelectorAll("img").length,
      tileNames: g ? [...g.querySelectorAll("button[aria-pressed]")].map((b) => b.innerText.replace(/\s+/g, " ")) : [],
      chips: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => t && t.length < 30).slice(0, 30),
    };
  });
  log("4. grid state:", JSON.stringify(gridState));

  // Tap the photo dish specifically
  const photo = page.getByRole("button", { name: /Photo Dish 50585/ });
  log("5. Photo Dish tile present:", await photo.count());
  if (await photo.count()) {
    await photo.first().click();
    await page.waitForTimeout(2500);
    const afterTap = await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      dialogText: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText.replace(/\s+/g, " ").slice(0, 300)),
      cart: document.body.innerText.replace(/\s+/g, " ").match(/Subtotal.{0,260}/)?.[0] ?? "no subtotal",
    }));
    log("5b. after tapping an item:", JSON.stringify(afterTap));
    await shot(page, "R34-after-tap");
  }

  // Tap a 16%-tax seeded dish for contrast
  const karahi = page.getByRole("button", { name: /Chicken Karahi/ });
  if (await karahi.count()) {
    await karahi.first().click();
    await page.waitForTimeout(2500);
    log("6. cart after adding a 16% seeded dish:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").match(/Subtotal.{0,300}/)?.[0] ?? "none"));
    await shot(page, "R35-cart-mixed");
  }

  log("7. menu item requests observed:", JSON.stringify([...new Set(seen)]));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });

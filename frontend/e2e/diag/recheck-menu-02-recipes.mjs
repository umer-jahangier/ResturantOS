// RECHECK — recipes half of "menu, products, images, modifiers, recipes".
// The prior report gave NO recipe verdict. Drive it: can a manager author a recipe
// for a dish they just created, see a plate cost, and have it persist?
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const TARGET = process.argv[2] ?? "Recheck Dish";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

async function shot(page, n) { await page.screenshot({ path: `${OUT}/${n}.png` }); log("   shot", n); }

async function health(page, label) {
  for (let i = 1; i <= 2; i++) {
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({
      alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()).filter(Boolean),
      bad: /Couldn.t load|Access denied|Something went wrong|doesn.t exist/i.test(document.body.innerText),
      snippet: document.body.innerText.slice(0, 250).replace(/\s+/g, " "),
    }));
    if (!info.bad && !info.alerts.length) return { ok: true, attempt: i, ...info };
    if (i === 1) { log(`   !! ${label} unhealthy on attempt 1 — reloading. ${JSON.stringify(info)}`); await page.reload({ waitUntil: "domcontentloaded" }); continue; }
    return { ok: false, attempt: i, ...info };
  }
}

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await s.count())) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const netFail = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) netFail.push(`${r.status()} ${r.url().replace("http://localhost:8080", "")}`); });

  if (!(await login(page, { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" }))) { log("LOGIN FAILED"); await browser.close(); return; }

  await page.goto(`${BASE}/app/inventory/recipes`, { waitUntil: "domcontentloaded" });
  log("1. recipes index health:", JSON.stringify(await health(page, "recipes")));
  await shot(page, "R20-recipes-index");

  // Is the freshly-created menu item even in the recipe catalog? (cross-service sync)
  const catalog = await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Menu item"]');
    return {
      options: sel ? [...sel.options].map((o) => o.text) : null,
      rows: [...document.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ")),
    };
  });
  log("2. catalog options:", JSON.stringify(catalog.options));
  log("2b. table rows:", JSON.stringify(catalog.rows));
  const inCatalog = (catalog.options ?? []).some((o) => o.includes(TARGET));
  log(`2c. brand-new dish "${TARGET}" appears in recipe catalog:`, inCatalog);

  // Drive the detail page for a dish that DOES exist in the catalog
  const firstLink = page.locator('tbody tr a').first();
  const linkName = await firstLink.textContent();
  const href = await firstLink.getAttribute("href");
  log("3. opening recipe detail for:", linkName, href);
  await firstLink.click();
  await page.waitForTimeout(3500);
  log("3b. detail health:", JSON.stringify(await health(page, "recipe detail")));
  await shot(page, "R21-recipe-detail");
  const detail = await page.evaluate(() => ({
    url: location.pathname,
    controls: [...document.querySelectorAll("input,select,textarea")].map((e) => `${e.tagName.toLowerCase()}:${e.getAttribute("aria-label") || e.name || e.placeholder || "?"}`),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
  }));
  log("3c. detail:", JSON.stringify(detail));

  // Author a revision: pick first ingredient, qty, uom, submit
  const selects = page.locator("main select, form select");
  log("4. select count on detail:", await selects.count());
  const selInfo = await page.evaluate(() =>
    [...document.querySelectorAll("select")].map((s) => ({ aria: s.getAttribute("aria-label"), name: s.name, opts: [...s.options].map((o) => o.text).slice(0, 8) })));
  log("4b. selects:", JSON.stringify(selInfo));

  await shot(page, "R22-recipe-form");
  log("NETFAIL:", JSON.stringify([...new Set(netFail)].slice(0, 15)));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });

// RECHECK — author a recipe revision end to end for the dish created in script 01,
// then reload and prove it persisted with a plate cost.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const TARGET = process.argv[2] ?? "Recheck Dish 186597";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("   shot", n); };

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  else log("   !! no tenantSlug field rendered on /login");
  await page.locator('input[name="email"], input#email').first().fill("manager@terrace.local");
  await page.locator('input[name="password"], input#password').first().fill("Terrace#Manager1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const netFail = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) netFail.push(`${r.status()} ${r.url().replace("http://localhost:8080", "")}`); });
  if (!(await login(page))) { log("LOGIN FAILED"); await browser.close(); return; }

  await page.goto(`${BASE}/app/inventory/recipes`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("link", { name: TARGET }).click();
  await page.waitForTimeout(3000);
  log("1. detail url:", page.url());

  await page.getByRole("button", { name: /Create first recipe version/i }).first().click();
  await page.waitForTimeout(2500);
  await shot(page, "R23-recipe-author-open");

  const form = await page.evaluate(() => ({
    inDialog: !!document.querySelector('[role="dialog"]'),
    selects: [...document.querySelectorAll("select")].map((s) => ({ aria: s.getAttribute("aria-label"), name: s.name, n: s.options.length, first: [...s.options].slice(0, 5).map((o) => o.text) })),
    inputs: [...document.querySelectorAll("input")].map((i) => `${i.name || i.getAttribute("aria-label") || i.placeholder}:${i.type}`),
    text: document.body.innerText.replace(/\s+/g, " ").slice(300, 1400),
  }));
  log("2. author form:", JSON.stringify(form));

  // Fill: yield servings, one ingredient line
  const yieldIn = page.locator('input[name="yieldServings"]');
  if (await yieldIn.count()) await yieldIn.first().fill("1");

  const ingSel = page.locator('select[name="lines.0.ingredientId"], select').filter({ hasText: /./ });
  const selCount = await page.locator("select").count();
  log("3. selects on page:", selCount);
  // choose by index: ingredient select then uom select
  const sels = page.locator("select");
  for (let i = 0; i < selCount; i++) {
    const meta = await sels.nth(i).evaluate((s) => ({ name: s.name, aria: s.getAttribute("aria-label"), opts: [...s.options].map((o) => o.value).filter(Boolean) }));
    if (meta.opts.length) {
      await sels.nth(i).selectOption(meta.opts[0]);
      log(`3b. select[${i}] name=${meta.name} aria=${meta.aria} -> ${meta.opts[0]}`);
      await page.waitForTimeout(400);
    } else {
      log(`3b. select[${i}] name=${meta.name} aria=${meta.aria} HAS NO OPTIONS`);
    }
  }
  const qty = page.locator('input[name="lines.0.qty"]');
  if (await qty.count()) await qty.first().fill("2");
  await page.waitForTimeout(2500);
  await shot(page, "R24-recipe-filled");

  const costBefore = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").match(/.{0,120}(plate cost|Plate cost|Cost).{0,200}/)?.[0] ?? "no cost text");
  log("4. cost panel text:", costBefore);

  const saveBtn = page.getByRole("button", { name: /Save|Create|Publish|Add revision|New recipe/i });
  const names = await saveBtn.evaluateAll((els) => els.map((e) => e.textContent.trim()));
  log("5. save-ish buttons:", JSON.stringify(names));
  await saveBtn.last().click();
  await page.waitForTimeout(4000);
  await shot(page, "R25-recipe-saved");
  log("6. after save text:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(300, 1200)));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await shot(page, "R26-recipe-after-reload");
  log("7. after reload:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(300, 1300)));

  await page.goto(`${BASE}/app/inventory/recipes`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  log("8. index rows:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ")))));
  await shot(page, "R27-recipes-index-after");
  log("NETFAIL:", JSON.stringify([...new Set(netFail)].slice(0, 20)));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });

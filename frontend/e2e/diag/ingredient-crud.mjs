// DIAGNOSIS ONLY — fill the ingredient form properly and prove create + edit works from screens.
import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(p.slug);
  await page.locator('input#email, input[name="email"]').first().fill(p.email);
  await page.locator('input#password, input[name="password"]').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
for (let i = 1; i <= 4; i++) { await login(page, P); if (!page.url().includes("/login")) break; await page.waitForTimeout(4000); }
const calls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.request().method() !== "GET")
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "").split("?")[0]}`);
});

await page.goto(`${BASE}/app/inventory/ingredients`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.locator("button").filter({ hasText: /^\s*Add ingredient\s*$/i }).first().click();
await page.waitForTimeout(2500);
const dlg = page.locator('[role="dialog"]');
const name = `DIAG Rice ${Date.now().toString().slice(-6)}`;

// The "What is X?" help buttons carry the same aria-label as the field, so match real
// form controls only, by their associated <label> text.
const setByLabel = async (label, value) => {
  const re = new RegExp(label, "i");
  const el = dlg.locator("input, select, textarea").filter({
    has: undefined,
  });
  const n = await el.count();
  for (let i = 0; i < n; i++) {
    const c = el.nth(i);
    const txt = await c.evaluate((e) => (e.labels?.[0]?.innerText || e.getAttribute("name") || e.getAttribute("placeholder") || "").trim());
    if (!re.test(txt)) continue;
    const tag = await c.evaluate((e) => e.tagName.toLowerCase());
    if (tag === "select") {
      const opts = await c.evaluate((e) => [...e.options].map((o) => o.value));
      const pick = opts.find((o) => o && o !== "");
      if (pick) await c.selectOption(pick);
      console.log(`  set ${label} (select) = ${pick}`);
    } else {
      await c.fill(String(value));
      console.log(`  set ${label} = ${value}`);
    }
    return;
  }
  console.log(`  no control matched ${label}`);
};
await setByLabel("^Name", name);
await setByLabel("SKU", `DIAG-${Date.now().toString().slice(-6)}`);
await setByLabel("Primary category", "");
await setByLabel("Measure type", "");
await setByLabel("Stock unit", "");
await setByLabel("Recipe unit", "");
await setByLabel("Par level", "40");
await setByLabel("Reorder point", "10");
await setByLabel("Shelf life", "7");
await page.screenshot({ path: `${OUT}/ingredient-filled.png`, fullPage: false });

await dlg.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6000);
const body = await page.locator("body").innerText();
console.log("\nCREATED?", body.includes(name) ? `YES — "${name}" appears in the list` : "NO");
const alerts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter(Boolean);
if (alerts.length) console.log("alerts:", JSON.stringify(alerts.slice(0, 5)));
await page.screenshot({ path: `${OUT}/ingredient-created.png`, fullPage: true });
console.log("mutating calls:\n  " + calls.join("\n  "));
await browser.close();

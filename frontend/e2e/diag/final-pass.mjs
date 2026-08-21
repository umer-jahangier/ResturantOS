// DIAGNOSIS ONLY — (1) create an ingredient through the UI, (2) vendor catalogue/price list,
// (3) re-check the "missing" routes WHILE SIGNED IN (the first sweep hit them logged out).
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
if (page.url().includes("/login")) { console.log("COULD NOT SIGN IN"); await browser.close(); process.exit(1); }
console.log("signed in ok");
const calls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.request().method() !== "GET")
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "").split("?")[0]}`);
});

// ---- 1. Missing-route re-check WHILE SIGNED IN ----
console.log("\n########## ROUTE EXISTENCE (signed in) ##########");
for (const r of ["/app/inventory/wastage", "/app/inventory/transfers", "/app/inventory/counts",
                 "/app/inventory/valuation", "/app/inventory/movements", "/app/purchasing/goods-receipt",
                 "/app/purchasing/requisitions", "/app/purchasing/returns"]) {
  await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const t = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n");
  const head = (t.split("Collapse").pop() || t).trim().slice(0, 150).replace(/\n/g, " | ");
  console.log(`${r}  -> ${page.url().replace(BASE, "")}  :: ${head}`);
}

// ---- 2. Ingredient create through the UI ----
console.log("\n########## INGREDIENT CREATE ##########");
await page.goto(`${BASE}/app/inventory/ingredients`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const add = page.locator("button").filter({ hasText: /^\s*Add ingredient\s*$/i });
if (await add.count()) {
  await add.first().click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    console.log(`dialog size=${box ? Math.round(box.width) + "x" + Math.round(box.height) : "none"}`);
    const f = await dlg.first().evaluate((d) =>
      [...d.querySelectorAll("input,select,textarea")].map((e) => {
        const l = e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.name;
        return `${e.tagName.toLowerCase()}: ${(l || "").trim().slice(0, 50)}`;
      }));
    console.log("fields:\n  " + f.join("\n  "));
    const name = `DIAG Ingredient ${Date.now().toString().slice(-6)}`;
    const nameIn = dlg.locator('input').first();
    await nameIn.fill(name);
    await page.screenshot({ path: `${OUT}/ingredient-dialog.png`, fullPage: false });
    const submit = dlg.locator('button[type="submit"]');
    if (await submit.count()) {
      await submit.first().click();
      await page.waitForTimeout(5000);
      const after = await page.locator("body").innerText();
      console.log("created?", after.includes(name) ? `YES — "${name}" is in the list` : "NO — not visible in list");
      const errs = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
      if (errs.length) console.log("alerts:", JSON.stringify(errs.slice(0, 4)));
      await page.screenshot({ path: `${OUT}/ingredient-after-create.png`, fullPage: true });
    }
  } else console.log("ADD INGREDIENT DIALOG DID NOT OPEN");
} else console.log("Add ingredient button NOT FOUND");

// ---- 3. Vendor catalogue / price list ----
console.log("\n########## VENDOR CATALOGUE ##########");
await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const cat = page.getByText("Manage catalog", { exact: false });
if (await cat.count()) {
  await cat.first().click();
  await page.waitForTimeout(6000);
  console.log("vendor detail url:", page.url());
  const t = await page.locator("body").innerText();
  const b = await page.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean));
  console.log("buttons:", JSON.stringify(b.filter((x) => !/Collapse|Search|^F$|Floating Terrace HQ/.test(x))));
  console.log((t.split("Collapse").pop() || t).replace(/\n{2,}/g, "\n").slice(0, 1800));
  await page.screenshot({ path: `${OUT}/vendor-catalog.png`, fullPage: true });
}
console.log("\nmutating calls:\n  " + calls.join("\n  "));
await browser.close();

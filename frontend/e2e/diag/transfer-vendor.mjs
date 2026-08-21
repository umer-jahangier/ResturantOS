// DIAGNOSIS ONLY — complete an inter-branch transfer and create a vendor, end to end.
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

// ---------- TRANSFER ----------
console.log("########## INTER-BRANCH TRANSFER ##########");
await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
await page.locator("button").filter({ hasText: /^\s*Transfer\s*$/ }).first().click();
await page.waitForTimeout(2500);
let dlg = page.locator('[role="dialog"]');
// destination branch
const sel = dlg.locator("select").first();
const opts = await sel.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text })));
console.log("branch options:", JSON.stringify(opts));
const dest = opts.find((o) => o.v);
if (dest) { await sel.selectOption(dest.v); console.log("destination =", dest.t); }
// ingredient combobox
const combo = dlg.locator("button").filter({ hasText: /Select an ingredient/i });
if (await combo.count()) {
  await combo.first().click();
  await page.waitForTimeout(1500);
  const search = page.locator('input[type="search"], input[placeholder*="earch"]');
  if (await search.count()) { await search.first().fill("Basmati"); await page.waitForTimeout(1500); }
  // Scope to the popup listbox — page.getByRole("option") also matches native <select> options.
  const opt = page.locator('[role="listbox"] [role="option"], [cmdk-item], [data-slot="command-item"]');
  const n = await opt.count();
  console.log("combobox options visible:", n);
  if (n) { await opt.first().click(); console.log("picked ingredient"); }
  await page.waitForTimeout(1200);
}
const qty = dlg.locator('input').filter({ hasNot: undefined }).last();
await qty.fill("2").catch(() => console.log("could not fill qty"));
await page.screenshot({ path: `${OUT}/transfer-filled.png`, fullPage: false });
const ship = dlg.locator('button[type="submit"]');
if (await ship.count()) {
  await ship.first().click();
  await page.waitForTimeout(6000);
}
const alerts1 = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter(Boolean);
console.log("after ship — alerts:", JSON.stringify(alerts1.slice(0, 4)));
console.log("dialog still open?", await page.locator('[role="dialog"]').count());
await page.screenshot({ path: `${OUT}/transfer-result.png`, fullPage: true });

// ---------- VENDOR CREATE ----------
console.log("\n########## VENDOR CREATE ##########");
await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.locator("button").filter({ hasText: /^\s*Add vendor\s*$/i }).first().click();
await page.waitForTimeout(2500);
dlg = page.locator('[role="dialog"]');
const box = await dlg.first().boundingBox();
console.log(`vendor dialog size=${box ? Math.round(box.width) + "x" + Math.round(box.height) : "none"}`);
const fields = await dlg.first().evaluate((d) =>
  [...d.querySelectorAll("input,select,textarea")].map((e) => {
    const l = e.labels?.[0]?.innerText || e.getAttribute("name") || e.getAttribute("placeholder") || "";
    return `${e.tagName.toLowerCase()}: ${l.trim().slice(0, 45)}`;
  }));
console.log("vendor fields:\n  " + fields.join("\n  "));
const vname = `DIAG Vendor ${Date.now().toString().slice(-6)}`;
await dlg.locator("input").first().fill(vname);
await page.screenshot({ path: `${OUT}/vendor-dialog.png`, fullPage: false });
const vs = dlg.locator('button[type="submit"]');
if (await vs.count()) { await vs.first().click(); await page.waitForTimeout(6000); }
const body = await page.locator("body").innerText();
console.log("VENDOR CREATED?", body.includes(vname) ? `YES — "${vname}" in list` : "NO");
const alerts2 = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter(Boolean);
if (alerts2.length) console.log("alerts:", JSON.stringify(alerts2.slice(0, 4)));
await page.screenshot({ path: `${OUT}/vendor-created.png`, fullPage: true });
console.log("\nmutating calls:\n  " + calls.join("\n  "));
await browser.close();

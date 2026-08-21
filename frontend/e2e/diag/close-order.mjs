// DIAGNOSIS ONLY — depletion is driven by ORDER_CLOSED. Paying does not close an order.
// So: ring + pay a Chicken Karahi, then CLOSE it from the UI, and measure Basmati Rice.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

function token() {
  return JSON.parse(execSync(
    `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
  ).toString()).data.accessToken;
}
function rice() {
  const rows = JSON.parse(execSync(
    `curl -s "${GW}/api/v1/inventory/stock?branchId=${BRANCH}" -H "Authorization: Bearer ${token()}"`,
  ).toString()).data.items;
  const r = rows.find((x) => x.ingredientId.startsWith("cdb0de29"));
  return { qty: r.qtyOnHand, valPaisa: r.stockValuePaisa };
}

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

const before = rice();
console.log("BEFORE Basmati Rice:", JSON.stringify(before));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
mkdirSync(OUT, { recursive: true });
const posts = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.request().method() !== "GET")
    posts.push(`${r.status()} ${r.request().method()} ${r.url().replace(GW, "").split("?")[0]}`);
});
await login(page, P);

// 1. ring + pay
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.getByText("Chicken Karahi", { exact: false }).first().click();
await page.waitForTimeout(2000);
await page.locator("button").filter({ hasText: /^\s*Charge Now\s*$/i }).first().click();
await page.waitForTimeout(4000);
for (const step of ["Full amount", "Record Payment"]) {
  const b = page.locator("button").filter({ hasText: new RegExp(`^\\s*${step}\\s*$`, "i") });
  if (await b.count()) { await b.first().click(); await page.waitForTimeout(step === "Record Payment" ? 6000 : 1200); }
}
const orderUrl = page.url();
console.log("order page:", orderUrl);

// 2. hunt for a close/complete control on the order screen
const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean));
console.log("buttons on paid order screen:\n  " + btns.join("\n  "));

for (const label of [/^\s*Complete\b/i, /^\s*Close\b/i, /Mark (as )?(complete|served|done)/i, /^\s*Finish/i]) {
  const b = page.locator("button").filter({ hasText: label });
  if (await b.count()) {
    console.log("clicking close-ish control:", (await b.first().innerText()).trim());
    await b.first().click();
    await page.waitForTimeout(5000);
    break;
  }
}
await page.screenshot({ path: `${OUT}/order-close-attempt.png`, fullPage: true });

// 3. also try the Order Management tab, which lists open orders
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const om = page.getByText("Order Management", { exact: false });
if (await om.count()) {
  await om.first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/order-management.png`, fullPage: true });
  const t = await page.locator("body").innerText();
  console.log("ORDER MANAGEMENT:\n" + t.split("Collapse").pop().replace(/\n{2,}/g, "\n").slice(0, 2500));
  const b2 = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean));
  console.log("buttons:\n  " + b2.join("\n  "));
}
console.log("mutating calls:\n  " + posts.join("\n  "));
await browser.close();
await new Promise((r) => setTimeout(r, 8000));
const after = rice();
console.log("AFTER  Basmati Rice:", JSON.stringify(after), "DELTA:", after.qty - before.qty);

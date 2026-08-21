// DIAGNOSIS ONLY — does selling a dish in the POS actually reduce ingredient stock?
// Chicken Karahi's current recipe consumes 0.25 KG of Basmati Rice.
// Reads stock BEFORE, rings + pays the dish through the real POS UI, reads stock AFTER.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const RICE = "cdb0de29-cc90-4cbb-844d-af788eaf4b52";
const P = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

function token() {
  const out = execSync(
    `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' ` +
      `-d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
  ).toString();
  return JSON.parse(out).data.accessToken;
}
function riceQty() {
  const t = token();
  const out = execSync(
    `curl -s "${GW}/api/v1/inventory/stock?branchId=${BRANCH}" -H "Authorization: Bearer ${t}"`,
  ).toString();
  const rows = JSON.parse(out).data.items;
  const r = rows.find((x) => (x.ingredientId || "").startsWith("cdb0de29"));
  return r ? { qty: r.qtyOnHand, avgPaisa: r.avgCostPaisa, valPaisa: r.stockValuePaisa } : null;
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

const before = riceQty();
console.log("BEFORE  Basmati Rice:", JSON.stringify(before));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
mkdirSync(OUT, { recursive: true });
const posts = [];
page.on("response", (r) => {
  if (/\/api\/.*(orders|payment|pos)/.test(r.url()) && r.request().method() !== "GET")
    posts.push(`${r.status()} ${r.request().method()} ${r.url().replace(GW, "")}`);
});

await login(page, P);
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.screenshot({ path: `${OUT}/pos-01-open.png`, fullPage: true });

// Ring the dish.
const dish = page.getByText("Chicken Karahi", { exact: false });
console.log("Chicken Karahi tiles found:", await dish.count());
if (await dish.count()) {
  await dish.first().click();
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: `${OUT}/pos-02-rung.png`, fullPage: true });
console.log("cart text:", (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").slice(-1800));

// Try to send/pay.
for (const label of [/^\s*Pay\b/i, /^\s*Charge\b/i, /Send to kitchen/i, /Place order/i]) {
  const b = page.locator("button").filter({ hasText: label });
  if (await b.count()) {
    console.log("clicking:", label.source, "->", (await b.first().innerText()).trim());
    await b.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/pos-03-${label.source.replace(/\W/g, "")}.png`, fullPage: true });
    break;
  }
}
// Complete the tender: CASH -> Full amount -> Record Payment.
for (const step of ["CASH", "Full amount", "Record Payment"]) {
  const b = page.locator("button").filter({ hasText: new RegExp(`^\\s*${step}\\s*$`, "i") });
  if (await b.count()) {
    await b.first().click();
    console.log("  clicked", step);
    await page.waitForTimeout(step === "Record Payment" ? 6000 : 1500);
  } else {
    console.log("  MISSING control:", step);
  }
}
await page.screenshot({ path: `${OUT}/pos-05-paid.png`, fullPage: true });
const bodyNow = await page.locator("body").innerText();
console.log("after-pay screen:\n" + bodyNow.replace(/\n{2,}/g, "\n").slice(-2200));
console.log("mutating api calls:", posts.join("\n  ") || "(none)");
await page.screenshot({ path: `${OUT}/pos-04-final.png`, fullPage: true });
await browser.close();

await new Promise((r) => setTimeout(r, 6000));
const after = riceQty();
console.log("AFTER   Basmati Rice:", JSON.stringify(after));
console.log("DELTA:", before && after ? after.qty - before.qty : "n/a");

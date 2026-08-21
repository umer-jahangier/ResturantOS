// DIAGNOSIS ONLY — the real close path: ring -> Send to Kitchen -> Mark Served -> Charge -> pay.
// Depletion fires on ORDER_CLOSED; an order closes when fully paid AND served.
// Polls stock for 90s afterwards, because the first run showed the effect arrives late.
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
const click = async (page, re, tag) => {
  const b = page.locator("button").filter({ hasText: re });
  const n = await b.count();
  if (!n) { console.log(`  MISSING: ${tag}`); return false; }
  await b.first().click({ timeout: 15000 }).catch((e) => console.log(`  click failed ${tag}: ${String(e).slice(0, 90)}`));
  console.log(`  clicked ${tag}`);
  return true;
};

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

await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.getByText("Chicken Karahi", { exact: false }).first().click();
await page.waitForTimeout(2000);

await click(page, /^\s*Send to Kitchen\s*$/i, "Send to Kitchen");
await page.waitForTimeout(6000);
await click(page, /^\s*Mark Served\s*$/i, "Mark Served");
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/sp-01-served.png`, fullPage: true });

await click(page, /^\s*CHARGE NOW\s*$/i, "CHARGE NOW");
await page.waitForTimeout(5000);
for (const step of ["Full amount", "Record Payment"]) {
  await click(page, new RegExp(`^\\s*${step}\\s*$`, "i"), step);
  await page.waitForTimeout(step === "Record Payment" ? 7000 : 1500);
}
await page.screenshot({ path: `${OUT}/sp-02-paid.png`, fullPage: true });
const body = await page.locator("body").innerText();
console.log("FINAL ORDER SCREEN:\n" + (body.split("Collapse").pop() || body).replace(/\n{2,}/g, "\n").slice(0, 1500));
console.log("mutating calls:\n  " + posts.join("\n  "));
await browser.close();

for (let i = 1; i <= 9; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const now = rice();
  console.log(`t+${i * 10}s  qty=${now.qty}  delta=${(now.qty - before.qty).toFixed(4)}`);
  if (now.qty !== before.qty) break;
}

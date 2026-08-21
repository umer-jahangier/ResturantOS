// DIAGNOSIS ONLY — is the PO detail page reachable from the list, and what does it offer?
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

function token() {
  return JSON.parse(execSync(
    `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
  ).toString()).data.accessToken;
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

// Find PO ids + statuses straight from the API so we can address detail pages directly.
const t = token();
const pos = JSON.parse(execSync(`curl -s "${GW}/api/v1/purchasing/purchase-orders?branchId=34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03&size=100" -H "Authorization: Bearer ${t}"`).toString()).data;
const rows = Array.isArray(pos) ? pos : pos.content || pos.items || [];
const byStatus = {};
for (const p of rows) if (!byStatus[p.status]) byStatus[p.status] = p;
console.log("PO statuses available:", Object.keys(byStatus).join(", "));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
const calls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.request().method() !== "GET")
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace(GW, "").split("?")[0]}`);
});
await login(page, P);

// Is there ANY link out of the PO list rows?
await page.goto(`${BASE}/app/purchasing/purchase-orders`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const anchors = await page.evaluate(() =>
  [...document.querySelectorAll("table a, tbody a, [role=row] a")].map((a) => a.getAttribute("href")));
console.log("anchors inside the PO table:", JSON.stringify(anchors));
const rowClickable = await page.evaluate(() => {
  const tr = document.querySelector("tbody tr");
  if (!tr) return "no rows";
  return { onclick: !!tr.onclick, cursor: getComputedStyle(tr).cursor, role: tr.getAttribute("role"), cls: tr.className.slice(0, 120) };
});
console.log("first row:", JSON.stringify(rowClickable));

for (const [status, po] of Object.entries(byStatus)) {
  await page.goto(`${BASE}/app/purchasing/purchase-orders/${po.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const body = await page.locator("body").innerText();
  const b = await page.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean));
  console.log(`\n=== PO ${status} -> ${page.url()}`);
  console.log("buttons:", JSON.stringify(b.filter((x) => !/Collapse|Search|^F$|Floating Terrace HQ/.test(x))));
  console.log((body.split("Collapse").pop() || body).replace(/\n{2,}/g, "\n").slice(0, 1800));
  await page.screenshot({ path: `${OUT}/podetail-${status}.png`, fullPage: true });
}
console.log("\nmutating calls:\n  " + calls.join("\n  "));
await browser.close();

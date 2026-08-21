// DIAGNOSIS ONLY — why did the transfer ingredient picker show no options, and did the
// vendor that POSTed 200 actually land in the list?
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const tok = JSON.parse(execSync(
  `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
).toString()).data.accessToken;
const vendors = JSON.parse(execSync(`curl -s "${GW}/api/v1/purchasing/vendors" -H "Authorization: Bearer ${tok}"`).toString()).data;
const vlist = Array.isArray(vendors) ? vendors : vendors.content || [];
console.log("vendors via API:", vlist.length, "| DIAG vendors:", vlist.filter((v) => (v.name || "").startsWith("DIAG")).map((v) => v.name));

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

// vendor list after a fresh load
await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
const vbody = await page.locator("body").innerText();
console.log("DIAG vendor visible on a FRESH page load?", /DIAG Vendor/.test(vbody) ? "YES" : "NO");
console.log("vendor count rendered:", (vbody.match(/Manage catalog/g) || []).length);

// transfer dialog deep dive
console.log("\n########## TRANSFER DIALOG ##########");
await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
await page.locator("button").filter({ hasText: /^\s*Transfer\s*$/ }).first().click();
await page.waitForTimeout(2500);
const dlg = page.locator('[role="dialog"]');
await dlg.locator("select").first().selectOption("c2d74ade-7ff8-4167-8cd0-131bfbdf4fba");
await page.waitForTimeout(1200);
const combo = dlg.locator("button").filter({ hasText: /Select an ingredient/i });
console.log("combobox trigger count:", await combo.count());
await combo.first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/transfer-combo-open.png`, fullPage: false });
// what actually appeared?
const popup = await page.evaluate(() => {
  const sels = ['[role="listbox"]', "[cmdk-list]", '[data-slot="command-list"]', '[role="dialog"] [role="option"]', "[cmdk-item]"];
  const out = {};
  for (const s of sels) out[s] = document.querySelectorAll(s).length;
  const lb = document.querySelector('[role="listbox"], [cmdk-list], [data-slot="command-list"]');
  out.text = lb ? lb.innerText.slice(0, 400) : "(no listbox element)";
  return out;
});
console.log("popup probe:", JSON.stringify(popup, null, 1));
const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] input')].map((i) => ({ ph: i.placeholder, type: i.type, vis: i.offsetParent !== null })));
console.log("dialog inputs:", JSON.stringify(inputs));
await browser.close();

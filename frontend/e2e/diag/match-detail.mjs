// DIAGNOSIS ONLY — the three-way match screen for a MISMATCHED invoice.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

const t = JSON.parse(execSync(
  `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
).toString()).data.accessToken;
const invs = JSON.parse(execSync(`curl -s "${GW}/api/v1/purchasing/invoices?branchId=${BRANCH}&size=200" -H "Authorization: Bearer ${t}"`).toString()).data;
const list = Array.isArray(invs) ? invs : invs.content || [];
const mismatched = list.find((i) => i.status === "MISMATCHED");
const matched = list.find((i) => i.status === "MATCHED");
console.log("mismatched invoice:", mismatched && mismatched.id, "| matched:", matched && matched.id);

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

for (const [tag, inv] of [["MISMATCHED", mismatched], ["MATCHED", matched]]) {
  if (!inv) continue;
  await page.goto(`${BASE}/app/purchasing/invoices/${inv.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  const body = await page.locator("body").innerText();
  const b = await page.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.innerText.trim()).filter(Boolean));
  console.log(`\n=== INVOICE ${tag} ${page.url()}`);
  console.log("buttons:", JSON.stringify(b.filter((x) => !/Collapse|Search|^F$|Floating Terrace HQ/.test(x))));
  console.log((body.split("Collapse").pop() || body).replace(/\n{2,}/g, "\n").slice(0, 2500));
  await page.screenshot({ path: `${OUT}/invoice-${tag}.png`, fullPage: true });
}
await browser.close();

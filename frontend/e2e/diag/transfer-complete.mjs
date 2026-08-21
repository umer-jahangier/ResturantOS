// DIAGNOSIS ONLY — complete an inter-branch transfer (ship), then check the receive side.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOF = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

function tok() {
  // The gateway intermittently answers an empty body under load; retry rather than crash,
  // so a flaky auth call never masquerades as a broken feature.
  for (let i = 0; i < 6; i++) {
    const raw = execSync(
      `curl -s -X POST ${GW}/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@terrace.local","password":"Terrace#Manager1","tenantSlug":"floating-terrace"}'`,
    ).toString();
    try { const t = JSON.parse(raw).data.accessToken; if (t) return t; } catch { /* retry */ }
    execSync("sleep 3");
  }
  throw new Error("could not obtain a token after 6 attempts");
}
function qty(branch) {
  const items = JSON.parse(execSync(`curl -s "${GW}/api/v1/inventory/stock?branchId=${branch}" -H "Authorization: Bearer ${tok()}"`).toString()).data.items;
  const r = items.find((x) => x.ingredientId.startsWith("cdb0de29"));
  return r ? r.qtyOnHand : null;
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
console.log("BEFORE  HQ rice:", qty(HQ));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await ctx.newPage();
for (let i = 1; i <= 4; i++) { await login(page, P); if (!page.url().includes("/login")) break; await page.waitForTimeout(4000); }
const calls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.request().method() !== "GET")
    calls.push(`${r.status()} ${r.request().method()} ${r.url().replace(GW, "").split("?")[0]}`);
});

await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
await page.locator("button").filter({ hasText: /^\s*Transfer\s*$/ }).first().click();
await page.waitForTimeout(2500);
const dlg = page.locator('[role="dialog"]');
await dlg.locator("select").first().selectOption(ROOF);
await page.waitForTimeout(1000);
await dlg.locator("button").filter({ hasText: /Select an ingredient/i }).first().click();
await page.waitForTimeout(2500);
const search = page.locator('[role="dialog"] input[placeholder="Search…"]');
if (await search.count()) { await search.first().fill("Basmati"); await page.waitForTimeout(1800); }
const opts = page.locator('[cmdk-item], [role="listbox"] [role="option"]');
console.log("options after search:", await opts.count());
await opts.first().click();
await page.waitForTimeout(1500);
// qty input is the one with placeholder "10"
const qi = page.locator('[role="dialog"] input[placeholder="10"]');
await qi.first().fill("2");
console.log("filled qty=2");
await page.screenshot({ path: `${OUT}/transfer-ready.png`, fullPage: false });
await dlg.locator('button[type="submit"]').first().click();
await page.waitForTimeout(7000);
const alerts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter(Boolean);
console.log("alerts:", JSON.stringify(alerts.slice(0, 5)));
console.log("dialog still open?", await page.locator('[role="dialog"]').count());
await page.screenshot({ path: `${OUT}/transfer-shipped.png`, fullPage: true });
console.log("mutating calls:\n  " + calls.join("\n  "));

// Receive side
await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.locator("button").filter({ hasText: /^\s*Transfer\s*$/ }).first().click();
await page.waitForTimeout(2000);
const recv = page.locator('[role="dialog"] button').filter({ hasText: /^\s*Receive\s*$/ });
if (await recv.count()) {
  await recv.first().click();
  await page.waitForTimeout(3000);
  console.log("\nRECEIVE TAB:\n" + (await page.locator('[role="dialog"]').innerText()).replace(/\n{2,}/g, "\n").slice(0, 1200));
  await page.screenshot({ path: `${OUT}/transfer-receive-tab.png`, fullPage: false });
}
await browser.close();
console.log("\nAFTER   HQ rice:", qty(HQ));

/* Read the printed bill of the over-tendered check, with enough patience for the route to render. */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F7-reopen";
const ORDER = process.argv[2];

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
if (await s.count()) await s.first().fill("floating-terrace");
await page.locator('input[name="email"], input#email').first().fill("cashier@terrace.local");
await page.locator('input[name="password"], input#password').first().fill("Terrace#Cashier1");
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6500);

await page.goto(`${BASE}/app/pos/orders/${ORDER}/receipt`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /TOTAL/.test(document.body.innerText), { timeout: 45000 });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    text: t.replace(/\n{2,}/g, "\n").slice(0, 2200),
    reprint: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
    originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
    total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    cash: /CASH\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    tendered: /TENDERED\s*\n?\s*(Rs [\d,]+\.\d\d)/i.exec(t)?.[1] ?? null,
    change: /CHANGE\s*\n?\s*(Rs [\d,]+\.\d\d)/i.exec(t)?.[1] ?? null,
  };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: `${OUT}/d-over-tender-bill.png`, fullPage: true });
writeFileSync(`${OUT}/d-bill.json`, JSON.stringify(out, null, 2));
await browser.close();

// Admin walkthrough: log in, visit key pages, capture screenshots + console/page errors.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const TENANT = "test";
const OUT =
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/60d88bf0-c840-474e-b08a-41882bdc7219/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["dashboard", "/app/dashboard"],
  ["pos", "/app/pos"],
  ["kitchen", "/app/kitchen"],
  ["inventory", "/app/inventory"],
  ["finance-accounts", "/app/finance/accounts"],
  ["finance-journal", "/app/finance/journal-entries"],
  ["purchasing", "/app/purchasing"],
  ["settings", "/app/settings"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 200)}`));

// login as admin
await page.goto(`${BASE}/login?tenant=${TENANT}`, { waitUntil: "networkidle" });
const tf = page.locator('input[name="tenantSlug"]');
if (await tf.isVisible({ timeout: 1000 }).catch(() => false)) await tf.fill(TENANT);
await page.locator('input[type="email"]').fill("admin@test.com");
await page.locator('input[type="password"]').fill("Test@123!");
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/app\//, { timeout: 20000 });

for (const [name, path] of PAGES) {
  const before = errors.length;
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/tour-${name}.png`, fullPage: false });
  const pageErrors = errors.slice(before);
  console.log(`[${name}] ${path} url=${page.url().replace(BASE, "")} errors=${pageErrors.length}`);
  pageErrors.forEach((e) => console.log(`    ${e}`));
}
await browser.close();
console.log(`\nTotal errors: ${errors.length}`);

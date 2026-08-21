/*
 * Does a branch switch SURVIVE (a) client-side navigation and (b) a hard reload?
 * If it silently reverts, a manager can read HQ's numbers believing they are Rooftop's.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const chip = (page) => page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button")).map((b) => b.innerText.replace(/\s+/g, " ").trim());
  return {
    switcherLabel: btns.find((b) => /Floating Terrace/.test(b)) || null,
    breadcrumbChip: (document.body.innerText.match(/Floating Terrace[^\n]*/g) || []).slice(0, 3),
    rows: Array.from(document.querySelectorAll("table tbody tr")).length,
    empty: /no data for this period/i.test(document.body.innerText),
  };
});

async function main() {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const steps = [];
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"]').first().fill("manager@terrace.local");
  await page.locator('input[name="password"]').first().fill("Terrace#Manager1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);

  await page.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  steps.push({ step: "0-on-hq-report", ...(await chip(page)) });

  await page.locator('button:has-text("Floating Terrace HQ")').first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role="menuitem"]:has-text("Rooftop")').first().click();
  await page.waitForTimeout(9000);
  steps.push({ step: "1-after-switch-to-rooftop", ...(await chip(page)) });
  await page.screenshot({ path: `${OUT}/bp-1-rooftop.png`, fullPage: true });

  // (a) CLIENT-SIDE navigation via the sidebar link
  await page.locator('a[href="/app/dashboard"]').first().click();
  await page.waitForTimeout(6000);
  steps.push({ step: "2-client-nav-to-dashboard", ...(await chip(page)) });
  await page.screenshot({ path: `${OUT}/bp-2-clientnav-dashboard.png`, fullPage: true });

  await page.locator('a[href="/app/reports"]').first().click();
  await page.waitForTimeout(4000);
  await page.locator('a[href="/app/reports/sales-by-day"]').first().click();
  await page.waitForTimeout(5000);
  steps.push({ step: "3-client-nav-back-to-report", ...(await chip(page)) });
  await page.screenshot({ path: `${OUT}/bp-3-clientnav-report.png`, fullPage: true });

  // (b) HARD RELOAD — what a real user does with F5
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  steps.push({ step: "4-after-hard-reload", ...(await chip(page)) });
  await page.screenshot({ path: `${OUT}/bp-4-after-reload.png`, fullPage: true });

  for (const s of steps) console.log(JSON.stringify(s));
  writeFileSync(`${OUT}/branch-persist.json`, JSON.stringify(steps, null, 2));
  await b.close();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });

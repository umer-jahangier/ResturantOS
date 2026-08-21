/*
 * Can a user compare two branches' numbers? Drive the manager (the ONLY persona seeded onto
 * both Floating Terrace branches) through the branch switcher and back. Diagnose only.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const log = [];

const snap = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  const rows = Array.from(document.querySelectorAll("table tbody tr")).map((r) => r.innerText.replace(/\s+/g, " ").trim());
  return {
    url: location.href,
    rows,
    rowCount: rows.length,
    alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map((n) => n.innerText.trim()).filter(Boolean),
    branchChip: (t.match(/Floating Terrace[^\n]*/g) || []).slice(0, 4),
    emptyState: /no data for this period/i.test(t),
    hasTable: document.querySelectorAll("table").length > 0,
  };
});

async function main() {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const net = [];
  page.on("response", (r) => { if (/\/api\//.test(r.url()) && r.status() >= 400) net.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"]').first().fill("manager@terrace.local");
  await page.locator('input[name="password"]').first().fill("Terrace#Manager1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  console.log("manager url:", page.url());

  await page.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const before = await snap(page);
  console.log("HQ rows:", before.rowCount, JSON.stringify(before.rows));
  await page.screenshot({ path: `${OUT}/bc-01-hq.png`, fullPage: true });

  // Find the branch switcher — it is a DropdownMenuTrigger button in the sidebar.
  const trigger = page.locator('button:has-text("Floating Terrace HQ")');
  console.log("switcher candidates:", await trigger.count());
  if (await trigger.count() === 0) {
    console.log("SIDEBAR BUTTONS:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((x) => x.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30))));
  }
  await trigger.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/bc-02-menu.png`, fullPage: true });
  const menuItems = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"],[role="option"]')).map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  console.log("menu items:", JSON.stringify(menuItems));

  const roof = page.locator('[role="menuitem"]:has-text("Rooftop")').first();
  if (await roof.count()) {
    await roof.click();
    await page.waitForTimeout(9000);
  } else {
    console.log("NO Rooftop menu item");
  }
  const after = await snap(page);
  console.log("after switch url:", after.url, "rows:", after.rowCount, "empty:", after.emptyState, "chip:", JSON.stringify(after.branchChip), "alerts:", JSON.stringify(after.alerts));
  await page.screenshot({ path: `${OUT}/bc-03-rooftop.png`, fullPage: true });

  // Does the dashboard follow the switch?
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const dash = await snap(page);
  console.log("dashboard after switch chip:", JSON.stringify(dash.branchChip));
  await page.screenshot({ path: `${OUT}/bc-04-dashboard-rooftop.png`, fullPage: true });

  // Is there ANY side-by-side / compare control anywhere on the reports surface?
  await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const compare = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      compareWord: /compar|vs\.|versus|previous period|year over year|yoy|benchmark|side by side/i.test(t),
      controls: Array.from(document.querySelectorAll("select,button,input")).map((e) => `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || e.type || "").trim()}`).filter((x) => x.length > 4).slice(0, 40),
    };
  });
  console.log("compare controls:", JSON.stringify(compare, null, 1));

  log.push({ before, after, dash, compare, net, menuItems });
  writeFileSync(`${OUT}/branch-compare.json`, JSON.stringify(log, null, 2));
  console.log("net errors:", JSON.stringify(net));
  await b.close();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });

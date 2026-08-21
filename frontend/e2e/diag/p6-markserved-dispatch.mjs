/* PROBE 6 — pay (done) then Mark Served via the POS panel. Does the silent receipt enqueue? */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, instrumentPrint, BASE } from "./printlib.mjs";

const ORDER_NO = process.argv[2] ?? "ORD-20260812-0021";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await instrumentPrint(ctx);
const page = await ctx.newPage();
watchAuth(page, "[cashier]");
if (!(await login(page, "cashier"))) { console.log("ABORT"); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
// Switch to the Order Management tab — the POS lands on the new-order cart.
const omTab = page.locator('button:has-text("Order Management")').first();
console.log("Order Management tab present:", await omTab.count());
if (await omTab.count()) { await omTab.click(); await page.waitForTimeout(6000); }
await shot(page, "p6-pos-landing");

// Open the specific order's row action ("Open" / "Continue")
const rowEl = page.locator(`tr:has-text("${ORDER_NO}"), [role="row"]:has-text("${ORDER_NO}"), div:has-text("${ORDER_NO}")`).first();
console.log(`row for ${ORDER_NO}:`, await rowEl.count());
const openBtn = page.locator(`tr:has-text("${ORDER_NO}") button:has-text("Open"), tr:has-text("${ORDER_NO}") button:has-text("Continue")`).first();
console.log("row action button:", await openBtn.count());
if (await openBtn.count()) {
  await openBtn.click();
  await page.waitForTimeout(7000);
} else if (await rowEl.count()) {
  await rowEl.click();
  await page.waitForTimeout(7000);
}
await shot(page, "p6-order-open");
let body = await page.locator("body").innerText();
console.log("=== order panel ===");
console.log(body.slice(0, 1200));

const served = page.locator('button:has-text("Mark Served")');
console.log("\n'Mark Served' buttons visible:", await served.count());
if (await served.count()) {
  const n = await served.count();
  for (let i = 0; i < n; i++) {
    const b = page.locator('button:has-text("Mark Served")').first();
    if (!(await b.count())) break;
    await b.click();
    console.log(`  clicked Mark Served (${i + 1}/${n})`);
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(5000);
  await shot(page, "p6-after-markserved");
  body = await page.locator("body").innerText();
  console.log("\nstatus after marking served:", JSON.stringify(body.split("\n").filter((l) => /Closed|Served|Paid|In Progress/i.test(l)).slice(0, 6)));
  console.log("window.print calls during this (should be 0):", await page.evaluate(() => window.__printCalls));
}
await browser.close();

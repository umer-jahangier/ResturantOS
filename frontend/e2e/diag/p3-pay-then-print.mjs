/* PROBE 3 — cashier takes a real cash payment in the browser, then prints. End to end. */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, instrumentPrint, BASE } from "./printlib.mjs";

const ORDER = process.argv[2] ?? "ab28c300-0c59-4b60-8888-b914afd4c8b3";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await instrumentPrint(ctx);
const page = await ctx.newPage();
watchAuth(page, "[cashier]");
const net = [];
page.on("request", (r) => {
  if (r.url().includes(":7654")) net.push(`AGENT ${r.url()}`);
  if (/print-jobs|payments/.test(r.url())) net.push(`${r.method()} ${(r.url().split("/api")[1] || r.url()).slice(0, 80)}`);
});

if (!(await login(page, "cashier"))) { console.log("ABORT login"); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/pos/orders/${ORDER}/charge`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

// ---- Record a full cash payment through the UI ----
console.log("=== recording a CASH payment through the browser ===");
const full = page.locator('button:has-text("Full amount")');
if (await full.count()) { await full.first().click(); await page.waitForTimeout(1200); }
const rec = page.locator('button:has-text("Record Payment")');
console.log("Record Payment button:", await rec.count());
await rec.first().click();
await page.waitForTimeout(7000);
await shot(page, "p3-after-payment");

let body = await page.locator("body").innerText();
const statusLine = body.split("\n").filter((l) => /Paid|Unpaid|In Progress|Served|Closed|Partially/i.test(l)).slice(0, 8);
console.log("status chips after payment:", JSON.stringify(statusLine));
console.log("print calls after payment (should be 0 — no auto receipt):", await page.evaluate(() => window.__printCalls));

const printBtn = page.locator('[data-testid="print-bill-button"]');
console.log("'Print bill' button now present:", await printBtn.count());

if (await printBtn.count()) {
  await printBtn.first().click();
  await page.waitForTimeout(8000);
  console.log("\n=== RECEIPT SCREEN (reached by clicking Print bill) ===");
  console.log("url:", page.url());
  console.log("window.print() calls (automatic):", await page.evaluate(() => window.__printCalls));
  body = await page.locator("body").innerText();
  console.log("--- receipt text ---");
  console.log(body.slice(0, 1600));
  await shot(page, "p3-receipt");
  const again = page.locator('[data-testid="print-again-button"]');
  if (await again.count()) {
    await again.first().click();
    await page.waitForTimeout(1500);
    console.log("window.print() calls after pressing 'Print':", await page.evaluate(() => window.__printCalls));
  }
}
console.log("\nNETWORK:", JSON.stringify(net, null, 1));
await browser.close();

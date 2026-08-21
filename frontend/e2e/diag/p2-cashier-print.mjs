/* PROBE 2 — the cashier's actual paper path, clicked, with window.print counted. */
import { chromium } from "@playwright/test";
import { login, shot, watchAuth, instrumentPrint, BASE } from "./printlib.mjs";

const ORDER = process.argv[2] ?? "ab28c300-0c59-4b60-8888-b914afd4c8b3";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await instrumentPrint(ctx);
const page = await ctx.newPage();
watchAuth(page, "[cashier]");

const agentHits = [];
const printJobPosts = [];
page.on("request", (r) => {
  if (r.url().includes(":7654")) agentHits.push(r.url());
  if (/print-jobs/.test(r.url())) printJobPosts.push(`${r.method()} ${r.url().split("/api")[1] ?? r.url()}`);
});

if (!(await login(page, "cashier"))) { console.log("ABORT login"); await browser.close(); process.exit(1); }
console.log("signed in as CASHIER:", page.url());

// ---- 1. The charge screen, reached by URL (the click path from POS is exercised below) ----
await page.goto(`${BASE}/app/pos/orders/${ORDER}/charge`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
let body = await page.locator("body").innerText();
console.log("\n=== CHARGE SCREEN ===");
console.log("url:", page.url());
console.log("refusal?", /Access denied|do not have permission/i.test(body));
console.log("error?", /Couldn't load|Something went wrong/i.test(body));
console.log(body.slice(0, 900));
await shot(page, "p2-charge");

const printBtn = page.locator('[data-testid="print-bill-button"]');
console.log("\n'Print bill' button present:", await printBtn.count());
console.log("print calls BEFORE clicking Print bill:", await page.evaluate(() => window.__printCalls));

if (await printBtn.count()) {
  await printBtn.first().click();
  await page.waitForTimeout(7000);
  console.log("\n=== AFTER CLICKING 'Print bill' ===");
  console.log("url:", page.url());
  console.log("window.print() calls:", await page.evaluate(() => window.__printCalls));
  body = await page.locator("body").innerText();
  console.log("--- receipt body ---");
  console.log(body.slice(0, 1400));
  await shot(page, "p2-receipt-after-printbill");

  // Click the manual Print button too
  const again = page.locator('[data-testid="print-again-button"]');
  if (await again.count()) {
    await again.first().click();
    await page.waitForTimeout(1500);
    console.log("window.print() calls after clicking the 'Print' button:", await page.evaluate(() => window.__printCalls));
  }
}

console.log("\n=== NETWORK ===");
console.log("requests to the print agent (:7654):", agentHits.length, agentHits);
console.log("print-jobs calls:", JSON.stringify(printJobPosts, null, 1));

await browser.close();

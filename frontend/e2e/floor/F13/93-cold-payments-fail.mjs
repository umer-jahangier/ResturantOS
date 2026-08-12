/*
 * F13 RE-OPEN, part 3b — COLD load with the payments read failing.
 *
 * 92 proved nothing: React Query still held the previous successful payments response, so the
 * notice survived. The state that matters is a FRESH tab where GET .../payments has never
 * succeeded — `const { data: payments = [] }` then makes a failed read indistinguishable from
 * "no money on this check".
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log, drawerProbe } from "./lib.mjs";
import { readFileSync } from "node:fs";

const st = JSON.parse(readFileSync(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F13/_reopen.json", "utf8"));
const ORDER_NO = st.notes.cashierPartial.orderNo;

const browser = await newBrowser();
const page = await newPage(browser);
for (let a = 1; a <= 4; a++) {
  try { await login(page, PEOPLE.cashier); break; }
  catch (e) { log(`  login attempt ${a}: ${e.message.slice(0, 90)}`); await page.waitForTimeout(6000); if (a === 4) throw e; }
}

// Only the payments read. The order list, the order detail and everything else are untouched.
await page.route(
  (url) => url.pathname.startsWith("/api/v1/pos/orders/") && url.pathname.endsWith("/payments"),
  (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ title: "SERVICE_UNAVAILABLE", detail: "pos-service is restarting" }),
  }),
);

await go(page, "/app/pos", { waitMs: 8000 });
await page.getByText("Order Management", { exact: true }).click();
await page.waitForTimeout(4000);
await page.locator("[data-testid=order-management-search]").first().fill(ORDER_NO);
let id = null;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1500);
  id = await page.evaluate(() => document.querySelector('[data-testid^="open-order-"]')
    ?.getAttribute("data-testid")?.replace("open-order-", "") ?? null);
  if (id) break;
}
log("  row:", id);
if (!id) { await shot(page, "93x-no-row"); await browser.close(); process.exit(2); }
await page.locator(`[data-testid="open-order-${id}"]`).click();
await page.waitForTimeout(7000);
await shot(page, "93a-cold-payments-503");
const probe = await drawerProbe(page);
log("  notice :", JSON.stringify(probe.notice));
log("  Void   :", probe.voidTrigger);
log("  Refund :", probe.refundTrigger);

if (probe.voidTrigger) {
  log("\n  → Void IS offered on a check that HAS money on it. Pressing it as the cashier would.");
  await page.locator('[aria-label="Void order"]').click();
  await page.waitForTimeout(1500);
  await page.locator("[data-testid=void-refund-panel] textarea").first().fill("customer walked out");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Confirm Void/i }).click();
  await page.waitForTimeout(7000);
  await shot(page, "93b-void-attempt-result");
  const after = await page.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    refundAnywhere: !!document.querySelector('[aria-label="Refund order"]'),
  }));
  log("  void error copy   :", JSON.stringify(after.err));
  log("  Refund on screen? :", after.refundAnywhere);
}
await browser.close();

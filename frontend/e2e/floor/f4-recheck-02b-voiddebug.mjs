/*
 * Why did the void fail? Capture the actual HTTP response of the void call.
 */
import { BASE, WHO, launch, tab, signIn, shot, note, say } from "./f4-recheck-lib.mjs";

const browser = await launch();
const REASON = `F4 RECHECK void probe ${new Date().toISOString().slice(11, 19)} ${Math.random().toString(36).slice(2, 8)}`;
const mgr = await tab(browser, { tz: "Europe/Lisbon" });
const calls = [];
mgr.on("response", async (r) => {
  if (/void|refund/i.test(r.url())) {
    let b = null;
    try { b = (await r.text()).slice(0, 500); } catch { /* */ }
    calls.push({ s: r.status(), m: r.request().method(), u: r.url().replace("http://localhost:8080", ""), b });
  }
});
await signIn(mgr, WHO.manager);

await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await mgr.waitForTimeout(12_000);
await mgr.locator("[data-testid=order-type-takeaway]").click({ timeout: 30_000 });
await mgr.waitForTimeout(1200);
const tiles = mgr.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 40_000 });
await tiles.nth(2).click();
await mgr.waitForTimeout(1200);
await mgr.locator("[data-testid=send-to-kitchen-button]").click({ timeout: 30_000 });
await mgr.waitForTimeout(10_000);
const no = (await mgr.evaluate(() =>
  Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))))[0];
note("Z_orderNo", no);

await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await mgr.waitForTimeout(9000);
await mgr.getByText("Order Management", { exact: true }).click();
await mgr.waitForTimeout(6000);
await mgr.locator("[data-testid=order-management-search]").first().fill(no);
await mgr.waitForTimeout(7000);
await mgr.locator('[data-testid^="open-order-"]').first().click({ timeout: 35_000 });
await mgr.waitForTimeout(4500);
note("Z_orderStatusOnScreen", await mgr.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)));
await mgr.getByLabel("Void order").first().click({ timeout: 30_000 });
await mgr.waitForTimeout(2200);
const ta = mgr.locator("[data-testid=void-refund-panel] textarea");
if (await ta.count()) await ta.first().fill(REASON);
else await mgr.locator("[data-testid=void-refund-panel] input").first().fill(REASON);
await mgr.waitForTimeout(600);
await shot(mgr, "b04-void-panel");
await mgr.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void|Void Order|Void/i }).last().click();
await mgr.waitForTimeout(9000);
note("Z_voidCalls", calls);
note("Z_afterText", await mgr.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900)));
await shot(mgr, "b05-void-after");
await browser.close();
say("done");

// ATTACK 7: two things at once.
//  (a) PARTIAL receipt — target the input by its real aria-label, not .last().
//  (b) The panel renders on DRAFT POs. Can a user receive goods against a purchase order that was
//      never approved and never sent to the vendor? That is a segregation-of-duties hole nobody
//      has named.
import { chromium, newCtx, login, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";
const PO = process.argv[3] ?? "4884829c-16fe-4b60-be04-927718d08d89"; // DRAFT, 5 kg
const RECEIVE = process.argv[4] ?? "2";

const snap = async (page) => {
  await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await assertSession(page, "stock");
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("table tbody tr")]
    .map((r) => { const c = [...r.querySelectorAll("td")].map((x) => x.innerText.trim()); return [c[0].split("\n")[0], c[2]]; })));
};
const poHead = (page) => page.evaluate(() => document.body.innerText.split("Analytics")[1]?.slice(0, 220).replace(/\n+/g, " | "));

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 390, height: 844 });
  const api = [];
  page.on("response", (r) => { const u = r.url(); if (/\/purchasing\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  const before = await snap(page);
  await page.goto(`${BASE}/app/purchasing/purchase-orders/${PO}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  console.log(`\n=== PO ${PO.slice(0, 8)} BEFORE: ${await poHead(page)}`);

  const input = page.locator('input[aria-label^="Received quantity for line"]').first();
  console.log("  receive-qty inputs found:", await page.locator('input[aria-label^="Received quantity for line"]').count());
  console.log("  default value (should be ordered qty):", await input.inputValue());
  await input.fill(RECEIVE);
  await page.waitForTimeout(600);
  console.log(`  set receive qty = ${RECEIVE}; value now:`, await input.inputValue());
  await shot(page, `grn-partial-typed-${PO.slice(0, 8)}`);

  // over-receipt guard check
  await input.fill("999");
  await page.waitForTimeout(500);
  const overDisabled = await page.locator('button:has-text("Mock receive")').first().isDisabled();
  console.log("  over-receipt (999) blocks the button:", overDisabled);
  await input.fill(RECEIVE);
  await page.waitForTimeout(500);

  api.length = 0;
  await page.locator('button:has-text("Mock receive")').first().click();
  await page.waitForTimeout(5000);
  console.log("  api:", JSON.stringify(api));

  await page.goto(`${BASE}/app/purchasing/purchase-orders/${PO}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("  PO AFTER:", await poHead(page));
  const stillThere = await page.locator('input[aria-label^="Received quantity for line"]').count();
  console.log("  receive panel still present (can receive again?):", stillThere > 0);
  await shot(page, `grn-partial-after-${PO.slice(0, 8)}`);

  const after = await snap(page);
  const moved = Object.keys(after).filter((k) => before[k] !== after[k]);
  console.log("  >>> STOCK MOVED:", JSON.stringify(moved.map((k) => `${k}: ${before[k]} -> ${after[k]}`)));

  await browser.close();
}
main();

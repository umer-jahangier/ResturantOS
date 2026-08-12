/*
 * B2 STEP 5 — the whole claim, re-driven once, after the stack settled.
 *
 * The stack was restarted repeatedly by other agents mid-run, so this repeats the load-bearing
 * click path from a cold start: open a fresh drawer, ring a dine-in check, fire it, void it by
 * clicking, and confirm the row lands under Voided with the reason and the cashier's own name.
 * Nothing here is a manager.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, apiSend, tokenOf, branchOf,
  ringAndFire, openInOrderManagement, log,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);
const branch = await branchOf(cash, tok);

// The drawer was cashed up in step 4, so open a fresh one — as the cashier.
await go(cash, "/app/pos", { waitMs: 7000 });
const needsTill = await cash.evaluate(() => /No active till/i.test(document.body.innerText));
log("  needs a till:", needsTill);
if (needsTill) {
  const open = await apiSend(cash, "POST", "/api/v1/pos/tills",
    { branchId: branch, openingFloatPaisa: 500000 }, tok);
  log("  opened a fresh drawer:", open.status, JSON.stringify(open.body?.data ?? open.body).slice(0, 200));
}
await go(cash, "/app/pos", { waitMs: 7000 });
await shot(cash, "05a-fresh-till");

const fired = await ringAndFire(cash, { type: "dine_in", tiles: 2, label: "05b" });
log("  fired:", fired.orderNo, fired.row?.settlementStatus, "table", fired.row?.tableName);
if (fired.row?.settlementStatus !== "SENT_TO_KDS") {
  await browser.close();
  throw new Error(`expected SENT_TO_KDS, got ${fired.row?.settlementStatus}`);
}

const id = await openInOrderManagement(cash, fired.orderNo);
log("  drawer:", id);
await cash.getByLabel("Void order").first().click();
await cash.waitForTimeout(1600);
await cash.locator("[data-testid=void-refund-panel] textarea").first()
  .fill("Guest left before the food went out");
cash.__requests.length = 0;
await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void/i }).last().click();
await cash.waitForTimeout(6000);
await shot(cash, "05c-after-void");

const outcome = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
  panelStillOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
}));
const net = cash.__requests.filter((r) => /void/.test(r.u));
log("  outcome:", JSON.stringify(outcome), "network:", JSON.stringify(net));

await go(cash, "/app/pos", { waitMs: 7000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(3500);
await cash.locator("[data-testid=status-filter-VOIDED]").click();
await cash.waitForTimeout(4500);
await shot(cash, "05d-voided-chip");
const row = await cash.evaluate((no) => {
  const t = document.body.innerText;
  const i = t.indexOf(no);
  return i < 0 ? null : t.slice(i, i + 260).replace(/\s+/g, " ");
}, fired.orderNo);
log("  voided row:", row);
saveState({ recheck: { orderNo: fired.orderNo, net, outcome, row } });

await browser.close();
log("\nB2 step 5 done");

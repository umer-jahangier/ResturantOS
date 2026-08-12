/*
 * F1 RE-OPEN — probe. Independent of the fixing agent's run: a different cashier persona
 * (cashier@terrace.local, not the shift.* account they used), and the money path exercised
 * with a CASH TIP and a CARD tender, which their proof never touched.
 *
 * This step only LOOKS. It opens a drawer if there isn't one and reports the terrain.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log, money } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";

const OUT = "../.planning/audits/floor/F1-reopen";
mkdirSync(OUT, { recursive: true });
const shot = async (page, n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot: ${n}.png`); };

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
log("  cashier sub:", claims.sub, "branch:", branchId);
log("  perms:", JSON.stringify(claims.perms));

const t = await go(cash, "/app/pos", { waitMs: 9000 });
log("  /app/pos trouble:", JSON.stringify(t.bad), "alerts:", JSON.stringify(t.alerts));
await shot(cash, "p01-pos");

let state = await cash.evaluate(() => ({
  open: !!document.querySelector("[data-testid=close-till-button]"),
  closed: !!document.querySelector("[data-testid=open-till-button]"),
  unavailable: !!document.querySelector("[data-testid=till-status-unavailable]"),
  strip: document.querySelector("[data-testid=close-till-button]")?.closest("div")?.innerText.replace(/\s+/g, " ").trim() ?? null,
}));
log("  till state:", JSON.stringify(state));

if (!state.open) {
  log("  no open drawer — opening one with Rs 4,300.00 float (deliberately not a round 5,000)");
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(1200);
  await cash.locator("[data-testid=open-till-panel] input[type=number]").fill("4300");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(8000);
  await go(cash, "/app/pos", { waitMs: 8000 });
  state = await cash.evaluate(() => ({
    open: !!document.querySelector("[data-testid=close-till-button]"),
    strip: document.querySelector("[data-testid=close-till-button]")?.closest("div")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  }));
  log("  after open:", JSON.stringify(state));
}
await shot(cash, "p02-till-open");

const tills = await apiGet(cash, `/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, tok);
const till = (tills.body?.data ?? [])[0];
log("  till:", till?.id, "float", money(till?.openingFloatPaisa ?? 0));

const recon = await apiGet(cash, `/api/v1/pos/tills/${till.id}/reconciliation`, tok);
const rb = recon.body?.data ?? recon.body;
log("  server recon:", JSON.stringify({
  orderCount: rb.orderCount,
  cashCollectedPaisa: rb.cashCollectedPaisa,
  nonCashCollectedPaisa: rb.nonCashCollectedPaisa,
  liveExpectedCashPaisa: rb.liveExpectedCashPaisa,
  sessionExpectedClosingPaisa: rb.session.expectedClosingPaisa,
}));

console.log("\nTILL_ID=" + till.id);
console.log("BRANCH_ID=" + branchId);
console.log("CASHIER_SUB=" + claims.sub);
await browser.close();

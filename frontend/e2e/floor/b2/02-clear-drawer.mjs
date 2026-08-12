/*
 * B2 STEP 2 — the executed path for the seeded drawer's stranded checks.
 *
 * The cashier signs in and clears their own till WITHOUT a manager. Three real product paths,
 * chosen by what is true of each check — never by a database update:
 *
 *   unpaid, DRAFT/OPEN/SENT_TO_KDS  -> VOID with a reason      (what B2 unblocked)
 *   fully paid, not yet served      -> mark every line SERVED  (maybeCloseOrder then CLOSES it)
 *   anything else                   -> reported, never touched
 *
 * Every call is made from inside the signed-in page on the cashier's OWN bearer — the same
 * endpoint, the same authorization, the same persona as the button. The FIRST void is driven by
 * clicking, in 03-done-means.mjs; this file is the bulk that no one would sanely click 80 times.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, apiSend, tokenOf, branchOf,
  money, log,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);
const branch = await branchOf(cash, tok);
await go(cash, "/app/pos", { waitMs: 7000 });
await shot(cash, "02a-drawer-before");

const before = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    tillStrip: /Till (OPEN|CLOSED)[\s\S]{0,160}/.exec(t)?.[0].replace(/\s+/g, " ").trim() ?? null,
  };
});
log("  till strip before:", before.tillStrip);
saveState({ drawerBefore: before });

// The till the cashier is actually on.
const tills = await apiGet(cash, `/api/v1/pos/tills?branchId=${branch}&status=OPEN`, tok);
log("  tills:", tills.status, JSON.stringify(tills.body).slice(0, 400));
const till = (tills.body?.data ?? []).find((t) => t.status === "OPEN") ?? (tills.body?.data ?? [])[0];
log("  till id:", till?.id ?? till?.tillSessionId);

// Every non-terminal order this cashier holds, across every page.
async function nonTerminal() {
  const rows = [];
  for (let page = 0; page < 12; page++) {
    const r = await apiGet(cash, `/api/v1/pos/orders?branchId=${branch}&page=${page}&size=50`, tok);
    const data = r.body?.data ?? [];
    rows.push(...data);
    if (data.length < 50) break;
  }
  return rows;
}

let rows = await nonTerminal();
log(`\n  ${rows.length} live rows on the cashier's list`);
const byStatus = {};
for (const r of rows) byStatus[r.settlementStatus] = (byStatus[r.settlementStatus] ?? 0) + 1;
log("  by status:", JSON.stringify(byStatus));
saveState({ strandedBefore: rows.length, strandedByStatus: byStatus });

const result = { voided: 0, served: 0, failed: [], skipped: [] };

for (const r of rows) {
  const paid = r.amountPaidPaisa ?? 0;
  if (paid === 0) {
    const v = await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/void`,
      { reason: "End-of-shift clear-down: check abandoned, nothing tendered" }, tok);
    if (v.status >= 200 && v.status < 300) result.voided++;
    else result.failed.push({ no: r.orderNo, st: r.settlementStatus, status: v.status, body: v.body });
  } else {
    // Money was taken. A void would strand it — the food goes out and the check closes itself
    // (maybeCloseOrder: fully Paid AND fully Served). This is the settlement screen's own
    // "Mark served & close" button, same permission, same endpoint.
    const s = await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/serve-all`, {}, tok);
    if (s.status >= 200 && s.status < 300) result.served++;
    else result.failed.push({ no: r.orderNo, step: "serve-all", paid, status: s.status, body: s.body });
  }
}

log("\n  voided:", result.voided, " served-and-closed:", result.served,
    " failed:", result.failed.length);
if (result.failed.length) log("  first failures:", JSON.stringify(result.failed.slice(0, 5), null, 1));
saveState({ clearDown: result });

rows = await nonTerminal();
log("  live rows remaining:", rows.length);
if (rows.length) log("  remaining:", JSON.stringify(rows.slice(0, 8).map((r) => ({ no: r.orderNo, st: r.settlementStatus, paid: r.amountPaidPaisa }))));
saveState({ strandedAfter: rows.length, remainingSample: rows.slice(0, 8) });

await go(cash, "/app/pos", { waitMs: 7000 });
await shot(cash, "02b-drawer-after");
const after = await cash.evaluate(() => {
  const t = document.body.innerText;
  return { tillStrip: /Till (OPEN|CLOSED)[\s\S]{0,160}/.exec(t)?.[0].replace(/\s+/g, " ").trim() ?? null };
});
log("  till strip after:", after.tillStrip);
saveState({ drawerAfter: after });

await browser.close();
log("\nB2 step 2 done");

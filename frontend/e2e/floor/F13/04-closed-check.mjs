/*
 * F13 STEP 4 — the OTHER paid state, driven to CLOSED by clicking.
 *
 * Step 3 proved the live-and-paid check. A "fully paid check" can also mean CLOSED (paid AND
 * served, closed off on the charge page), and that is the state where the cashier used to get
 * an EMPTY action row — no button, no sentence, nothing saying a refund exists or who does it.
 * This drives one check all the way there and reads both personas' drawers on it.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, tokenOf,
  ringAndFire, openInOrderManagement, orderRow, money, log, drawerProbe, payInFullByClicking,
  ensureTill,
} from "./lib.mjs";

const fails = [];
const check = (ok, what, detail) => {
  log(`  ${ok ? "PASS" : "FAIL"} — ${what}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) fails.push(`${what} :: ${detail ?? ""}`);
};

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);

await ensureTill(cash, go);
const fired = await ringAndFire(cash, { type: "takeaway", tiles: 1, label: "04a" });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring the check"); }
log("  check:", fired.orderNo, money(fired.row?.totalPaisa ?? 0));

await payInFullByClicking(cash, fired.orderId, "04b");

// serve every line from the drawer, by clicking
await openInOrderManagement(cash, fired.orderNo);
const served = cash.getByRole("button", { name: /^Mark .* served$/ });
const n = await served.count();
log("  'Mark … served' buttons:", n);
for (let i = 0; i < n; i++) {
  await cash.getByRole("button", { name: /^Mark .* served$/ }).first().click();
  await cash.waitForTimeout(4000);
}
await shot(cash, "04c-after-marking-served");
log("  row after serving:", (await orderRow(cash, fired.orderNo, tok))?.settlementStatus ?? "?");

// close it off on the charge page, by clicking
await go(cash, `/app/pos/orders/${fired.orderId}/charge`, { waitMs: 6500 });
const closeState = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-order-button]");
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
});
log("  close control:", JSON.stringify(closeState));
if (closeState && !closeState.disabled) {
  await cash.locator("[data-testid=close-order-button]").click();
  await cash.waitForTimeout(7000);
}
await shot(cash, "04d-charge-after-close");
const rowNow = await orderRow(cash, fired.orderNo, tok);
const detail = await apiGet(cash, `/api/v1/pos/orders/${fired.orderId}`, tok);
const status = rowNow?.settlementStatus ?? detail.body?.data?.status ?? null;
log("  server status now:", status, "| live-list row:", JSON.stringify(rowNow?.settlementStatus ?? null));
check(status === "CLOSED", "the check really is CLOSED on the server", String(status));
saveState({ closedOrderNo: fired.orderNo, closedOrderId: fired.orderId, closedStatus: status });

// ── the cashier's drawer on the CLOSED, paid check ────────────────────────────
log("\n=== CASHIER — CLOSED and paid ===");
await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "04e-cashier-closed-drawer");
const c = await drawerProbe(cash);
log("  notice:", JSON.stringify(c.notice), "refund button:", c.refundTrigger);
check(c.notice !== null, "the cashier is told something at all (this used to be an empty row)", c.notice);
check(/manager/i.test(c.notice ?? ""), "and it names a manager", c.notice);
check(!/use refund/i.test(c.notice ?? ""), "and does not tell them to press Refund", c.notice);
check(c.refundTrigger === false, "Refund is still not on their screen", String(c.refundTrigger));
saveState({ closedCashierView: c });

// ── the manager's drawer on the same CLOSED check ─────────────────────────────
log("\n=== MANAGER — same CLOSED check ===");
const mgr = await newPage(browser);
for (let a = 1; a <= 3; a++) {
  try { await login(mgr, PEOPLE.manager); break; }
  catch (e) { log(`  login attempt ${a}: ${e.message.slice(0, 100)}`); await mgr.waitForTimeout(4000); if (a === 3) throw e; }
}
await openInOrderManagement(mgr, fired.orderNo);
await shot(mgr, "04f-manager-closed-drawer");
const m = await drawerProbe(mgr);
log("  notice:", JSON.stringify(m.notice), "refund button:", m.refundTrigger);
check(m.refundTrigger === true, "the manager can still refund the closed check", String(m.refundTrigger));
check(!/manager/i.test(m.notice ?? ""), "and is not sent to find a manager",
  m.notice ?? "(no notice — the Refund button is the instruction)");
saveState({ closedManagerView: m });

log("\n=========== F13 CLOSED-CHECK SUMMARY ===========");
log("  check:", fired.orderNo, "status:", status);
log("  cashier:", JSON.stringify(c.notice), "refund btn:", c.refundTrigger);
log("  manager:", JSON.stringify(m.notice), "refund btn:", m.refundTrigger);
log(fails.length === 0 ? "  ALL CHECKS PASS" : `  ${fails.length} FAILED:\n   - ${fails.join("\n   - ")}`);
saveState({ closedFails: fails });
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);

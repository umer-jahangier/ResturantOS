/*
 * F13 STEP 3 — DONE MEANS, driven by clicking, on ONE check, in both personas' hands.
 *
 *   A. the CASHIER opens their own drawer, rings a takeaway check, fires it
 *   B. the CASHIER takes the full amount in cash on the charge page
 *   C. the CASHIER opens it in Order Management: the notice must name a manager and must NOT
 *      tell them to press Refund, and Refund must genuinely not be on their screen
 *   D. the CASHIER marks every line served, so the same check settles to CLOSED, and reads the
 *      notice again — the state where they used to get an empty row and no information at all
 *   E. the MANAGER opens the SAME check: the notice reads as an instruction and Refund is there
 *   F. the same cashier drawer at 390 and 768, to prove the longer sentence still fits
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
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
check(!claims.permissions.includes("pos.order.refund"),
  "the cashier still does NOT hold pos.order.refund (no permission was widened)",
  JSON.stringify(claims.permissions.filter((p) => /refund|void/.test(p))));

// ── A / B ─────────────────────────────────────────────────────────────────────
log("\n=== A. ring and fire, as the cashier ===");
await ensureTill(cash, go);
const fired = await ringAndFire(cash, { type: "takeaway", tiles: 2, label: "03a" });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring the check"); }
log("  fired:", fired.orderNo, money(fired.row?.totalPaisa ?? 0));

log("\n=== B. full cash, clicked on the charge page ===");
const pay = await payInFullByClicking(cash, fired.orderId, "03b");
log("  charge page:", JSON.stringify(pay));
const payApi = await apiGet(cash, `/api/v1/pos/orders/${fired.orderId}/payments`, tok);
const rows = payApi.body?.data ?? [];
const sum = rows.reduce((a, r) => a + (r.amountPaisa ?? 0), 0);
check(sum === (fired.row?.totalPaisa ?? -1),
  "the check is FULLY paid, read back off the server",
  `${money(sum)} of ${money(fired.row?.totalPaisa ?? 0)}`);

// ── C. the cashier's drawer, live + paid ──────────────────────────────────────
log("\n=== C. CASHIER — paid check, still live ===");
await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "03c-cashier-live-paid-drawer");
const cLive = await drawerProbe(cash);
log("  notice:", JSON.stringify(cLive.notice), "refund button:", cLive.refundTrigger);
check(cLive.notice !== null, "the cashier gets a notice at all", cLive.notice);
check(!/use refund/i.test(cLive.notice ?? ""),
  "the cashier is NOT told to press Refund", cLive.notice);
check(/manager/i.test(cLive.notice ?? ""),
  "the notice names a manager as the person who can refund it", cLive.notice);
check(cLive.refundTrigger === false,
  "and Refund is genuinely absent from the cashier's screen", String(cLive.refundTrigger));
saveState({ dmCashierLive: cLive });

// ── D. the cashier serves every line, so the SAME check closes ────────────────
log("\n=== D. CASHIER — same check, marked served, now CLOSED ===");
const served = cash.getByRole("button", { name: /^Mark .* served$/ });
const n = await served.count();
log("  'Mark … served' buttons:", n);
for (let i = 0; i < n; i++) {
  await cash.getByRole("button", { name: /^Mark .* served$/ }).first().click();
  await cash.waitForTimeout(3500);
}
await cash.waitForTimeout(3000);
const rowClosed = await orderRow(cash, fired.orderNo, tok);
log("  server row after serving:", JSON.stringify(rowClosed?.settlementStatus ?? "not in the live list"));
await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "03d-cashier-closed-paid-drawer");
const cClosed = await drawerProbe(cash);
log("  notice:", JSON.stringify(cClosed.notice), "refund button:", cClosed.refundTrigger);
check(cClosed.notice !== null && /manager/i.test(cClosed.notice ?? ""),
  "on the settled check the cashier is still told a manager refunds it", cClosed.notice);
check(!/use refund/i.test(cClosed.notice ?? ""),
  "and is still not told to press a button they do not have", cClosed.notice);
saveState({ dmCashierClosed: cClosed, dmClosedStatus: rowClosed?.settlementStatus ?? null });

// ── F. the same drawer, narrow ────────────────────────────────────────────────
log("\n=== F. the cashier's drawer at 768 and 390 ===");
for (const [w, h, label] of [[768, 1024, "03f-cashier-768"], [390, 844, "03g-cashier-390"]]) {
  await cash.setViewportSize({ width: w, height: h });
  await cash.waitForTimeout(1500);
  await shot(cash, label);
  const fit = await cash.evaluate(() => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      text: n.textContent.trim(),
      visible: r.width > 0 && r.height > 0,
      right: Math.round(r.right),
      viewport: window.innerWidth,
      overflowsViewport: r.right > window.innerWidth + 1,
      color: cs.color,
      fontSize: cs.fontSize,
      docScrollsX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  log(`  ${w}px:`, JSON.stringify(fit));
  check(fit && fit.visible && !fit.overflowsViewport && !fit.docScrollsX,
    `the notice fits and is visible at ${w}px`, JSON.stringify(fit));
  saveState({ [`dmFit${w}`]: fit });
}
await cash.setViewportSize({ width: 1440, height: 950 });

// ── E. the manager, same check ────────────────────────────────────────────────
log("\n=== E. MANAGER — the same check ===");
const mgr = await newPage(browser);
for (let a = 1; a <= 3; a++) {
  try { await login(mgr, PEOPLE.manager); break; }
  catch (e) { log(`  login attempt ${a}: ${e.message.slice(0, 100)}`); await mgr.waitForTimeout(4000); if (a === 3) throw e; }
}
const mtok = await tokenOf(mgr);
const mclaims = JSON.parse(Buffer.from(mtok.split(".")[1], "base64").toString("utf8"));
check(mclaims.permissions.includes("pos.order.refund"),
  "the manager holds pos.order.refund", "");
await openInOrderManagement(mgr, fired.orderNo);
await shot(mgr, "03e-manager-same-check-drawer");
const mView = await drawerProbe(mgr);
log("  notice:", JSON.stringify(mView.notice), "refund button:", mView.refundTrigger);
check(mView.refundTrigger === true,
  "the Refund button IS on the manager's screen for the same check", String(mView.refundTrigger));
check(!/manager/i.test(mView.notice ?? ""),
  "the manager is not sent to find a manager", mView.notice ?? "(no notice — the button is the instruction)");
saveState({ dmManager: mView });

// The manager's live-paid reading is the other half of the DONE MEANS sentence. Ring one more
// check so the manager sees the SAME state the cashier saw in C, not the settled one.
log("\n=== E2. MANAGER — a live, paid check (the state the cashier read in C) ===");
await ensureTill(mgr, go);
const mFired = await ringAndFire(mgr, { type: "takeaway", tiles: 1, label: "03h" });
if (mFired.orderId) {
  await payInFullByClicking(mgr, mFired.orderId, "03i");
  await openInOrderManagement(mgr, mFired.orderNo);
  await shot(mgr, "03j-manager-live-paid-drawer");
  const mLive = await drawerProbe(mgr);
  log("  notice:", JSON.stringify(mLive.notice), "refund button:", mLive.refundTrigger);
  check(/use refund/i.test(mLive.notice ?? ""),
    "the manager's notice reads as an instruction — 'Use Refund'", mLive.notice);
  check(mLive.refundTrigger === true,
    "and the Refund button is present beside it", String(mLive.refundTrigger));
  saveState({ dmManagerLive: mLive, dmManagerOrderNo: mFired.orderNo });
} else {
  check(false, "could not ring a manager-side check for the live-paid comparison", "");
}

log("\n=========== F13 DONE-MEANS SUMMARY ===========");
log("  order under test:", fired.orderNo);
log("  cashier, live+paid  :", JSON.stringify(cLive.notice), "refund btn:", cLive.refundTrigger);
log("  cashier, closed+paid:", JSON.stringify(cClosed.notice), "refund btn:", cClosed.refundTrigger);
log("  manager, same check :", JSON.stringify(mView.notice), "refund btn:", mView.refundTrigger);
log(fails.length === 0 ? "  ALL CHECKS PASS" : `  ${fails.length} FAILED:\n   - ${fails.join("\n   - ")}`);
saveState({ dmFails: fails, dmOrderNo: fired.orderNo });
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);

/*
 * F13 STEP 1 — reproduce the finding by clicking, both personas, same order.
 *
 *  A. cashier signs in, rings a TAKEAWAY check, fires it
 *  B. cashier takes the full amount in cash on the charge page (clicked, not POSTed)
 *  C. cashier opens the check in Order Management: what does the drawer say, and what
 *     controls are actually on their screen?
 *  D. manager signs in, opens the SAME check: what does the drawer say and offer?
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, tokenOf,
  ringAndFire, openInOrderManagement, orderRow, money, log, drawerProbe, payInFullByClicking,
  ensureTill,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const posPerms = claims.permissions.filter((p) => /^pos\./.test(p)).sort();
log("  cashier sub:", claims.sub);
log("  cashier pos.* perms:", JSON.stringify(posPerms));
log("  holds pos.order.refund?", claims.permissions.includes("pos.order.refund"));
saveState({ cashierPosPerms: posPerms, cashierHasRefund: claims.permissions.includes("pos.order.refund") });

// ── A. ring and fire ──────────────────────────────────────────────────────────
log("\n=== A. takeaway check, fired ===");
await ensureTill(cash, go);
const fired = await ringAndFire(cash, { type: "takeaway", tiles: 2, label: "01a" });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring the check"); }
log("  fired:", fired.orderNo, fired.orderId, money(fired.row?.totalPaisa ?? 0));
saveState({ orderNo: fired.orderNo, orderId: fired.orderId, totalPaisa: fired.row?.totalPaisa ?? 0 });

// ── B. full cash, by clicking ─────────────────────────────────────────────────
log("\n=== B. full cash on the charge page ===");
const pay = await payInFullByClicking(cash, fired.orderId, "01b");
log("  charge page after Record payment:", JSON.stringify(pay));
const payApi = await apiGet(cash, `/api/v1/pos/orders/${fired.orderId}/payments`, tok);
const rows = payApi.body?.data ?? payApi.body ?? [];
const sum = (Array.isArray(rows) ? rows : []).reduce((a, r) => a + (r.amountPaisa ?? 0), 0);
log("  payments read back:", JSON.stringify(rows));
log("  amount held on the check:", money(sum), "of", money(fired.row?.totalPaisa ?? 0));
const rowNow = await orderRow(cash, fired.orderNo, tok);
log("  server row:", JSON.stringify(rowNow));
saveState({ paidUi: pay, payments: rows, amountPaidPaisa: sum, serverRow: rowNow });

// ── C. the cashier's drawer on the paid check ─────────────────────────────────
log("\n=== C. CASHIER — drawer on the paid check ===");
const idC = await openInOrderManagement(cash, fired.orderNo);
log("  drawer id:", idC);
await shot(cash, "01c-cashier-paid-drawer");
const cashierView = await drawerProbe(cash);
log("  CASHIER sees:", JSON.stringify(cashierView, null, 1));
saveState({ cashierView });

// ── D. the manager's drawer on the same check ─────────────────────────────────
log("\n=== D. MANAGER — same check ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);
const mclaims = JSON.parse(Buffer.from(mtok.split(".")[1], "base64").toString("utf8"));
log("  manager holds pos.order.refund?", mclaims.permissions.includes("pos.order.refund"));
const idM = await openInOrderManagement(mgr, fired.orderNo);
log("  drawer id:", idM);
await shot(mgr, "01d-manager-paid-drawer");
const managerView = await drawerProbe(mgr);
log("  MANAGER sees:", JSON.stringify(managerView, null, 1));
saveState({ managerHasRefund: mclaims.permissions.includes("pos.order.refund"), managerView });

log("\n--- VERDICT INPUTS ---");
log("  cashier notice :", JSON.stringify(cashierView.notice));
log("  cashier refund button on screen:", cashierView.refundTrigger);
log("  manager notice :", JSON.stringify(managerView.notice));
log("  manager refund button on screen:", managerView.refundTrigger);

await browser.close();
log("\nF13 step 1 done");

/*
 * B2 STEP 3 — DONE MEANS, driven by clicking, as the CASHIER and nobody else.
 *
 *  A. ring a DINE-IN check on a real table, Send to Kitchen
 *  B. the cook signs in and finds it on a KDS board (proof it really fired)
 *  C. back as the cashier: Order Management -> open -> Void -> reason -> Confirm Void
 *     -> success, and the row appears under the Voided chip with the reason and the
 *        cashier's OWN name
 *  D. a second check, cash taken against it: Void is refused for MONEY, not permission,
 *     and the payment row is read back afterwards to prove it is untouched
 *  E. still the cashier: Close Till -> a CLOSED till, no manager anywhere in this file
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, apiSend, tokenOf, branchOf,
  ringAndFire, openInOrderManagement, orderRow, money, log, BASE,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);
const branch = await branchOf(cash, tok);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
log("  cashier sub:", claims.sub, "perms:", claims.permissions.length,
    JSON.stringify(claims.permissions.filter((p) => /void/.test(p))));

// ── A. ring a DINE-IN check on a table and fire it ────────────────────────────
log("\n=== A. dine-in check, fired ===");
const fired = await ringAndFire(cash, { type: "dine_in", tiles: 2, label: "03a" });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring the dine-in check"); }
saveState({ dmOrderNo: fired.orderNo, dmOrderId: fired.orderId, dmRow: fired.row });
log("  row:", JSON.stringify(fired.row));

// ── B. the cook sees it ───────────────────────────────────────────────────────
log("\n=== B. the kitchen has it ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
let found = null;
for (const station of ["DEFAULT", "PANTRY1", "GRILL", "BAR"]) {
  const t = await go(kds, `/app/kitchen/${station}`, { waitMs: 6000 });
  if (t.bad?.length) { log(`  ${station}: ${t.bad.join(",")}`); continue; }
  const hit = await kds.evaluate((no) => {
    const body = document.body.innerText;
    const i = body.indexOf(no);
    return i < 0 ? null : body.slice(Math.max(0, i - 40), i + 260).replace(/\s+/g, " ").trim();
  }, fired.orderNo);
  log(`  ${station}: ${hit ? "FOUND" : "not here"}`);
  if (hit) { found = { station, card: hit }; await shot(kds, "03b-kds-board"); break; }
}
log("  kds:", JSON.stringify(found));
saveState({ dmKds: found });
await kds.close();

// ── C. the cashier voids it by clicking ───────────────────────────────────────
log("\n=== C. Order Management -> Void -> reason -> Confirm Void ===");
const id = await openInOrderManagement(cash, fired.orderNo);
log("  drawer for:", id);
await shot(cash, "03c-order-drawer");

const trigger = cash.getByLabel("Void order");
log("  'Void order' trigger:", await trigger.count());
await trigger.first().click();
await cash.waitForTimeout(1600);
await shot(cash, "03d-void-panel");
await cash.locator("[data-testid=void-refund-panel] textarea").first()
  .fill("Guest left before the food went out");
await cash.waitForTimeout(400);
await shot(cash, "03e-void-reason-typed");
cash.__requests.length = 0;
await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void/i }).last().click();
await cash.waitForTimeout(6000);
await shot(cash, "03f-after-confirm-void");

const after = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
  panelStillOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
  toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
}));
log("  panel after Confirm Void:", JSON.stringify(after));
log("  network:", JSON.stringify(cash.__requests.filter((r) => /void/.test(r.u))));
saveState({ dmVoidPanel: after, dmVoidNet: cash.__requests.filter((r) => /void/.test(r.u)) });

// the Voided chip — with the reason and who voided it
await go(cash, "/app/pos", { waitMs: 7000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(3500);
await cash.locator("[data-testid=status-filter-VOIDED]").click().catch(async () => {
  await cash.getByText("Voided", { exact: true }).click();
});
await cash.waitForTimeout(4500);
await shot(cash, "03g-voided-chip");
const voidedRow = await cash.evaluate((no) => {
  const t = document.body.innerText;
  const i = t.indexOf(no);
  return { present: i >= 0, ctx: i >= 0 ? t.slice(Math.max(0, i - 120), i + 400).replace(/\s+/g, " ") : null };
}, fired.orderNo);
log("  under the Voided chip:", JSON.stringify(voidedRow));
saveState({ dmVoidedChip: voidedRow });

const serverRow = await orderRow(cash, fired.orderNo, tok);
log("  server row now:", JSON.stringify(serverRow));
saveState({ dmVoidedServerRow: serverRow });

// ── D. the same cashier, a check with cash taken against it ───────────────────
log("\n=== D. cash taken, then Void ===");
const paid = await ringAndFire(cash, { type: "takeaway", tiles: 2, label: "03h" });
log("  paid-check order:", paid.orderNo, paid.orderId);
const total = paid.row?.totalPaisa ?? 0;
const pay = await apiSend(cash, "POST", `/api/v1/pos/orders/${paid.orderId}/payments`,
  { method: "CASH", amountPaisa: total, tenderedPaisa: total }, tok);
log("  cash taken:", pay.status, money(total));
const paymentsBefore = await apiGet(cash, `/api/v1/pos/orders/${paid.orderId}/payments`, tok);
log("  payments before the void attempt:", JSON.stringify(paymentsBefore.body?.data ?? paymentsBefore.body));

// what does the DRAWER offer now?
const idPaid = await openInOrderManagement(cash, paid.orderNo);
await shot(cash, "03i-paid-order-drawer");
const paidDrawer = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d ? {
    buttons: Array.from(d.querySelectorAll("button"))
      .map((b) => (b.getAttribute("aria-label") || b.textContent).trim()).filter(Boolean),
    paidNotice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
  } : null;
});
log("  drawer on the paid check:", JSON.stringify(paidDrawer));
saveState({ dmPaidDrawer: paidDrawer, dmPaidOrderNo: paid.orderNo });

const refused = await apiSend(cash, "POST", `/api/v1/pos/orders/${paid.orderId}/void`,
  { reason: "trying to void a check that has been paid" }, tok);
log("  POST /void on the paid check ->", refused.status, JSON.stringify(refused.body));
saveState({ dmVoidPaidRefusal: refused });

const paymentsAfter = await apiGet(cash, `/api/v1/pos/orders/${paid.orderId}/payments`, tok);
log("  payments AFTER the refused void:", JSON.stringify(paymentsAfter.body?.data ?? paymentsAfter.body));
saveState({ dmPaymentsAfter: paymentsAfter.body?.data ?? paymentsAfter.body });

// settle it properly so the drawer can close: the food goes out, the check closes itself
const serve = await apiSend(cash, "POST", `/api/v1/pos/orders/${paid.orderId}/serve-all`, {}, tok);
log("  serve-all ->", serve.status, "status now:", (await orderRow(cash, paid.orderNo, tok))?.settlementStatus ?? "gone from live list");

// ── E. Close Till, as the cashier, alone ──────────────────────────────────────
log("\n=== E. Close Till ===");
await go(cash, "/app/pos", { waitMs: 7000 });
await shot(cash, "03j-till-strip-before-close");
const strip = await cash.evaluate(() => {
  const t = document.body.innerText;
  return /Till (OPEN|CLOSED)[\s\S]{0,120}/.exec(t)?.[0].replace(/\s+/g, " ").trim() ?? null;
});
log("  till strip:", strip);

await cash.getByRole("button", { name: /Close Till/i }).first().click();
await cash.waitForTimeout(2500);
await shot(cash, "03k-close-till-panel");
const panel = await cash.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    text: t.slice(0, 900),
    fields: Array.from(document.querySelectorAll("input,textarea")).map((n) => ({
      label: n.getAttribute("aria-label") ?? n.placeholder ?? n.name ?? null,
      testid: n.getAttribute("data-testid"),
    })),
    buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 20),
  };
});
log("  close panel:", JSON.stringify(panel, null, 1));
saveState({ dmClosePanel: panel });

await browser.close();
log("\nB2 step 3 (A-D + close panel opened) done");

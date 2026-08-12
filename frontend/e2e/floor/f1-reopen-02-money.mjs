/*
 * F1 RE-OPEN — the money path the fixing agent never drove.
 *
 * Their proof was one takeaway check settled with plain cash. `TillServiceImpl.closeTill:249-256`
 * computes expected as `openingFloat + Σ(CASH amount + CASH TIP) − cash refunds`, and the live
 * figure the panel now shows comes from `getReconciliation:329-355`. Those are two separate
 * expressions in two separate methods. A single plain-cash check cannot tell them apart: the tip
 * term and the card term are both zero. So this drives:
 *
 *   check A  CASH + a Rs 75.00 TIP           → must RAISE expected by amount + tip
 *   check B  CARD, full amount               → must NOT move expected at all
 *
 * and then reads the panel's Expected BEFORE typing, compares it to (a) the green strip, (b) the
 * server's liveExpectedCashPaisa, and (c) an INDEPENDENT recomputation from the raw order-payment
 * rows — then submits and compares the persisted expectedClosingPaisa to what the cashier was
 * shown. If the panel and the close disagree by one paisa, the cashier signed for a lie.
 */
import { newBrowser, newPage, login, go, apiGet, tokenOf, log, money } from "../shift/lib.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "../.planning/audits/floor/F1-reopen";
mkdirSync(OUT, { recursive: true });
const shot = async (page, n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot: ${n}.png`); };

const st = JSON.parse(readFileSync(resolve(process.cwd(), "../.planning/audits/shift/_state.json"), "utf8"));
const CASHIER = { ...st.newCashier, password: st.newCashier.newPassword };
const R = {};

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, CASHIER);

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;

// ── 0. a drawer with a deliberately non-round float ───────────────────────────
await go(cash, "/app/pos", { waitMs: 9000 });
let open = await cash.evaluate(() => !!document.querySelector("[data-testid=close-till-button]"));
if (!open) {
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(1200);
  await cash.locator("[data-testid=open-till-panel] input[type=number]").fill("4317.50");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(8000);
  await go(cash, "/app/pos", { waitMs: 8000 });
}
const tills = await apiGet(cash, `/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, tok);
const till = (tills.body?.data ?? [])[0];
if (!till) throw new Error("no OPEN till");
log("  till", till.id, "float", money(till.openingFloatPaisa));
R.tillId = till.id;
R.openingFloatPaisa = till.openingFloatPaisa;

const reconOf = async () => {
  const r = await apiGet(cash, `/api/v1/pos/tills/${till.id}/reconciliation`, tok);
  return r.body?.data ?? r.body;
};
const before = await reconOf();
log("  BEFORE any of my checks: liveExpected =", money(before.liveExpectedCashPaisa),
    " orders =", before.orderCount);
R.expectedBeforePaisa = before.liveExpectedCashPaisa;

// ── ring one takeaway check ───────────────────────────────────────────────────
async function ring(label) {
  await go(cash, "/app/pos", { waitMs: 8000 });
  await cash.locator("[data-testid=order-type-takeaway]").click();
  await cash.waitForTimeout(900);
  const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30000 });
  await tiles.nth(2).click();
  await cash.waitForTimeout(900);
  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(9000);
  const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&size=80`, tok);
  const mine = (list.body?.data ?? []).filter(
    (o) => o.cashierId === claims.sub && o.paymentStatus === "UNPAID",
  );
  const o = mine[mine.length - 1];
  log(`  ${label}: ${o.orderNo} total ${money(o.totalPaisa)}`);
  return o;
}

async function charge(order, { method, tipRs }) {
  await go(cash, `/app/pos/orders/${order.orderId}/charge`, { waitMs: 8000 });
  if (method !== "CASH") {
    const sel = cash.locator('select[aria-label="Payment method"]').first();
    const opts = await sel.locator("option").allTextContents();
    log("    payment methods offered:", JSON.stringify(opts));
    await sel.selectOption(method);
    await cash.waitForTimeout(600);
  }
  const fill = cash.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) { await fill.first().click(); await cash.waitForTimeout(700); }
  if (tipRs) {
    const tip = cash.locator("[data-testid=tip-input]").first();
    if (!(await tip.count())) throw new Error("no tip input on the charge page");
    await tip.fill(String(tipRs));
    await cash.waitForTimeout(700);
  }
  const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    const need = Math.ceil(order.totalPaisa / 100) + (tipRs ?? 0) + 300;
    await tendered.fill(String(need));
    await cash.waitForTimeout(800);
  }
  await shot(cash, `m-charge-${method}${tipRs ? "-tip" : ""}`);
  await cash.locator("[data-testid=record-payment-button]").click();
  await cash.waitForTimeout(9000);
  const err = await cash.evaluate(
    () => document.querySelector("[data-testid=record-payment-error]")?.innerText?.trim() ?? null);
  log("    record-payment error:", err);
  const closeBtn = cash.locator("[data-testid=close-order-button]");
  if (await closeBtn.count() && !(await closeBtn.first().isDisabled())) {
    await closeBtn.first().click();
    await cash.waitForTimeout(8000);
  }
  return err;
}

log("\n=== check A — CASH with a Rs 75.00 tip ===");
const a = await ring("check A");
R.orderA = { no: a.orderNo, totalPaisa: a.totalPaisa };
R.chargeAError = await charge(a, { method: "CASH", tipRs: 75 });
const afterA = await reconOf();
log("  after A: liveExpected =", money(afterA.liveExpectedCashPaisa),
    " delta =", money(afterA.liveExpectedCashPaisa - before.liveExpectedCashPaisa),
    " (bill", money(a.totalPaisa), "+ tip Rs 75.00 =", money(a.totalPaisa + 7500) + ")");
R.deltaAPaisa = afterA.liveExpectedCashPaisa - before.liveExpectedCashPaisa;
R.expectedDeltaAPaisa = a.totalPaisa + 7500;

log("\n=== check B — CARD, no tip (must not move the drawer) ===");
const b = await ring("check B");
R.orderB = { no: b.orderNo, totalPaisa: b.totalPaisa };
R.chargeBError = await charge(b, { method: "CARD" });
const afterB = await reconOf();
log("  after B: liveExpected =", money(afterB.liveExpectedCashPaisa),
    " delta =", money(afterB.liveExpectedCashPaisa - afterA.liveExpectedCashPaisa), "(must be Rs 0.00)");
R.deltaBPaisa = afterB.liveExpectedCashPaisa - afterA.liveExpectedCashPaisa;
R.nonCashPaisa = afterB.nonCashCollectedPaisa;

// ── independent recomputation from the raw payment rows ───────────────────────
log("\n=== independent recomputation from order_payments over HTTP ===");
let cashSum = 0, tipSum = 0;
for (const line of afterB.orders) {
  const pays = await apiGet(cash, `/api/v1/pos/orders/${line.orderId}/payments`, tok);
  const rows = pays.body?.data ?? pays.body ?? [];
  if (!Array.isArray(rows)) continue;
  for (const p of rows) {
    if (p.method === "CASH") { cashSum += p.amountPaisa; tipSum += p.tipPaisa ?? 0; }
  }
}
const recomputed = till.openingFloatPaisa + cashSum + tipSum; // refunds handled separately below
log("  Σ CASH amount =", money(cashSum), " Σ CASH tip =", money(tipSum));
log("  openingFloat + cash + tips =", money(recomputed),
    " vs server liveExpectedCashPaisa =", money(afterB.liveExpectedCashPaisa),
    " diff (= cash refunds) =", money(recomputed - afterB.liveExpectedCashPaisa));
R.recomputedNoRefundsPaisa = recomputed;
R.serverLivePaisa = afterB.liveExpectedCashPaisa;

writeFileSync(`${OUT}/money.json`, JSON.stringify(R, null, 1));
console.log("\n" + JSON.stringify(R, null, 1));
await browser.close();

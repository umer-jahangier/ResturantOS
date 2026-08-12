/*
 * F13 RE-OPEN ATTEMPT — an independent drive of the claim, not a re-run of the author's script.
 *
 * Adds the paths the author's proof did not touch:
 *   1. RELOAD — does the sentence persist, or is it a first-paint artefact?
 *   2. A PARTIALLY paid check (money on it, not fully settled) — the author only drove full cash.
 *   3. The WAITER, who holds neither void nor refund — a third reader the copy never considered.
 *   4. The OTHER surface that renders the same component: the POS terminal's order panel.
 *   5. CROSS-TENANT: a Control Bistro cashier reaching for a Floating Terrace order.
 *   6. Both personas' permission sets read off their OWN live tokens (was anything widened?).
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, tokenOf,
  ringAndFire, openInOrderManagement, orderRow, money, log, drawerProbe, payInFullByClicking,
  ensureTill, BASE,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const fails = [];
const notes = {};
const check = (ok, what, detail) => {
  log(`  ${ok ? "PASS" : "FAIL"} — ${what}${detail !== undefined ? ` :: ${detail}` : ""}`);
  if (!ok) fails.push(`${what} :: ${detail ?? ""}`);
};

const WAITER = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };
const CTRL_CASHIER = {
  slug: "control-bistro-isolation-test-tenant",
  email: "cashier@control.local",
  password: "Control#Cashier1",
};

function claimsOf(tok) {
  return JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
}

/*
 * The B2 harness's ringAndFire now hangs: another agent has since shipped a modifier dialog that
 * opens on a tile with options, and its overlay eats the next tile click. Not a finding of mine —
 * but the tile click has to survive it, so this wraps the tile press: satisfy every required
 * group with its first option, then "Add to order".
 */
async function clearModifierDialog(page) {
  const dlg = page.locator("[data-testid=modifier-dialog]");
  if (!(await dlg.count())) return false;
  await page.waitForTimeout(1200);
  const add = page.locator("[data-testid=modifier-dialog-add]");
  for (let round = 0; round < 6; round++) {
    if ((await add.getAttribute("aria-disabled")) !== "true") break;
    const picked = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll("[data-testid^=modifier-group-]"))
        .filter((g) => g.tagName === "FIELDSET");
      for (const g of groups) {
        if (!/Required/i.test(g.innerText)) continue;
        const opt = Array.from(g.querySelectorAll("[data-testid^=modifier-option-]"))
          .find((b) => b.getAttribute("aria-checked") !== "true");
        if (opt) { opt.click(); return opt.getAttribute("data-testid"); }
      }
      return null;
    });
    if (!picked) break;
    await page.waitForTimeout(500);
  }
  await add.click();
  await page.waitForTimeout(1500);
  return true;
}

/** Ring + fire a takeaway check by clicking, tolerating the new modifier dialog. */
async function ring(page, { tiles = 2, label = "x", who } = {}) {
  await go(page, "/app/pos", { waitMs: 8000 });
  if (page.url().includes("/login")) { await login(page, who); await go(page, "/app/pos", { waitMs: 8000 }); }
  await page.locator("[data-testid=order-type-takeaway]").waitFor({ timeout: 30000 });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);
  const grid = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await grid.first().waitFor({ timeout: 30000 });
  for (let i = 0; i < tiles; i++) {
    await grid.nth(i).click({ timeout: 20000 });
    await page.waitForTimeout(900);
    await clearModifierDialog(page);
  }
  await page.waitForTimeout(900);
  await shot(page, `${label}-cart`);
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, `${label}-fired`);
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/g);
    return m ? m[0] : null;
  });
  const row = await orderRow(page, orderNo);
  log(`  fired: ${orderNo} ${row?.settlementStatus} id=${row?.orderId}`);
  return { orderNo, orderId: row?.orderId ?? null, row };
}

const browser = await newBrowser();

// ── 0. the tokens, live ───────────────────────────────────────────────────────
log("\n=== 0. what each persona's LIVE token actually carries ===");
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const ctok = await tokenOf(cash);
const cperm = claimsOf(ctok).permissions;
notes.cashierPosPerms = cperm.filter((p) => p.startsWith("pos."));
check(!cperm.includes("pos.order.refund"),
  "cashier token does NOT carry pos.order.refund", JSON.stringify(notes.cashierPosPerms));
check(cperm.includes("pos.order.void.own"),
  "cashier token still carries pos.order.void.own", "");

// ── 1. a fresh check, rung and fully paid by the cashier ──────────────────────
log("\n=== 1. cashier rings + pays a takeaway check ===");
await ensureTill(cash, go);
const fired = await ring(cash, { tiles: 2, label: "90a", who: PEOPLE.cashier });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring the check"); }
log("  fired:", fired.orderNo, money(fired.row?.totalPaisa ?? 0));
const pay = await payInFullByClicking(cash, fired.orderId, "90b");
log("  charge page:", JSON.stringify(pay));
const payApi = await apiGet(cash, `/api/v1/pos/orders/${fired.orderId}/payments`, ctok);
const sum = (payApi.body?.data ?? []).reduce((a, r) => a + (r.amountPaisa ?? 0), 0);
check(sum === (fired.row?.totalPaisa ?? -1), "fully paid, read back over HTTP",
  `${money(sum)} of ${money(fired.row?.totalPaisa ?? 0)}`);

// ── 2. the cashier's drawer, and the same drawer AFTER A RELOAD ───────────────
log("\n=== 2. cashier drawer — first paint, then reloaded ===");
await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "90c-cashier-first-paint");
const c1 = await drawerProbe(cash);
log("  notice:", JSON.stringify(c1.notice), "refund:", c1.refundTrigger, "void:", c1.voidTrigger);
check(c1.notice !== null, "cashier gets a notice", c1.notice);
check(!/use refund/i.test(c1.notice ?? ""), "cashier is NOT told to press Refund", c1.notice);
check(/manager/i.test(c1.notice ?? ""), "the notice names a manager", c1.notice);
check(c1.refundTrigger === false, "Refund is absent from the cashier's screen", String(c1.refundTrigger));

await cash.reload({ waitUntil: "domcontentloaded" });
await cash.waitForTimeout(6000);
const reopened = await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "90d-cashier-after-reload");
const c2 = await drawerProbe(cash);
log("  after reload:", JSON.stringify(c2.notice), "refund:", c2.refundTrigger, "id:", reopened);
check(c2.notice === c1.notice && c2.refundTrigger === false,
  "the sentence PERSISTS across a full reload", `${JSON.stringify(c2.notice)}`);
notes.cashierFullPaid = { first: c1, reload: c2, orderNo: fired.orderNo };

// ── 3. the POS terminal's own order panel (the second caller of the component) ─
log("\n=== 3. the OTHER surface: the terminal's order panel ===");
await go(cash, `/app/pos/orders/${fired.orderId}`, { waitMs: 7000, allowTrouble: true });
await shot(cash, "90e-cashier-order-detail");
const panel = await cash.evaluate(() => ({
  url: location.href,
  notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
  refund: !!document.querySelector('[aria-label="Refund order"]'),
  body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),
}));
log("  order-detail route:", JSON.stringify(panel));
notes.orderDetailRoute = panel;
if (panel.notice) {
  check(!/use refund/i.test(panel.notice) && /manager/i.test(panel.notice),
    "the SAME sentence on the order-detail surface", panel.notice);
} else {
  log("  (no notice on this route — recorded, not scored)");
}

// ── 4. a PARTIALLY paid check ─────────────────────────────────────────────────
log("\n=== 4. a partially paid check (money on it, not settled) ===");
const p2 = await ring(cash, { tiles: 2, label: "90f", who: PEOPLE.cashier });
let partial = null;
if (p2.orderId) {
  await cash.goto(`${BASE}/app/pos/orders/${p2.orderId}/charge`, { waitUntil: "domcontentloaded" });
  await cash.waitForTimeout(6500);
  const total = p2.row?.totalPaisa ?? 0;
  const half = (Math.round(total / 2) / 100).toFixed(2);
  await cash.locator('[aria-label="Amount (Rs)"]').first().fill(half);
  await cash.waitForTimeout(600);
  const tend = cash.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tend.count()) { await tend.fill(half); await cash.waitForTimeout(600); }
  await shot(cash, "90g-partial-charge");
  await cash.locator("[data-testid=record-payment-button]").click();
  await cash.waitForTimeout(6500);
  const pApi = await apiGet(cash, `/api/v1/pos/orders/${p2.orderId}/payments`, ctok);
  const psum = (pApi.body?.data ?? []).reduce((a, r) => a + (r.amountPaisa ?? 0), 0);
  log(`  partial paid ${money(psum)} of ${money(total)}`);
  await openInOrderManagement(cash, p2.orderNo);
  await shot(cash, "90h-cashier-partial-drawer");
  partial = await drawerProbe(cash);
  log("  notice:", JSON.stringify(partial.notice), "refund:", partial.refundTrigger, "void:", partial.voidTrigger);
  check(psum > 0 && psum < total, "the check really is PART paid", `${money(psum)}/${money(total)}`);
  check(partial.notice !== null && /manager/i.test(partial.notice ?? "") && !/use refund/i.test(partial.notice ?? ""),
    "part-paid: the cashier is told a manager refunds it, not to press Refund", partial.notice);
  check(partial.refundTrigger === false, "part-paid: no Refund control for the cashier", String(partial.refundTrigger));
  notes.cashierPartial = { probe: partial, paidPaisa: psum, totalPaisa: total, orderNo: p2.orderNo };
}

// ── 5. the WAITER: neither void nor refund ────────────────────────────────────
log("\n=== 5. the waiter, who holds neither void nor refund ===");
const wtr = await newPage(browser);
await login(wtr, WAITER);
const wtok = await tokenOf(wtr);
const wperm = claimsOf(wtok).permissions;
notes.waiterPerms = wperm;
check(!wperm.includes("pos.order.refund") && !wperm.some((p) => p.startsWith("pos.order.void")),
  "waiter token holds neither refund nor void", JSON.stringify(wperm));
const wid = await openInOrderManagement(wtr, fired.orderNo);
await shot(wtr, "90i-waiter-drawer");
const wView = wid ? await drawerProbe(wtr) : { notice: null, refundTrigger: null, note: "row not found" };
log("  waiter:", JSON.stringify(wView.notice), "refund:", wView.refundTrigger);
check(wView.refundTrigger !== true, "the waiter has no Refund control", String(wView.refundTrigger));
check(wView.notice === null || !/use refund/i.test(wView.notice),
  "the waiter is not told to press Refund either", wView.notice);
notes.waiter = wView;

// ── 6. the MANAGER on the SAME two checks ─────────────────────────────────────
log("\n=== 6. the manager, same checks ===");
const mgr = await newPage(browser);
for (let a = 1; a <= 3; a++) {
  try { await login(mgr, PEOPLE.manager); break; }
  catch (e) { log(`  login attempt ${a}: ${e.message.slice(0, 90)}`); await mgr.waitForTimeout(4000); if (a === 3) throw e; }
}
const mtok = await tokenOf(mgr);
const mperm = claimsOf(mtok).permissions;
check(mperm.includes("pos.order.refund"), "manager token carries pos.order.refund", "");
await openInOrderManagement(mgr, fired.orderNo);
await shot(mgr, "90j-manager-same-check");
const m1 = await drawerProbe(mgr);
log("  manager:", JSON.stringify(m1.notice), "refund:", m1.refundTrigger);
check(m1.refundTrigger === true, "the Refund button IS on the manager's screen, same order", String(m1.refundTrigger));
check(/use refund/i.test(m1.notice ?? ""), "the manager reads it as an instruction", m1.notice);
check(!/manager/i.test(m1.notice ?? ""), "the manager is not sent to find a manager", m1.notice);
notes.manager = m1;

if (p2.orderId) {
  await openInOrderManagement(mgr, p2.orderNo);
  await shot(mgr, "90k-manager-partial");
  const m2 = await drawerProbe(mgr);
  log("  manager, part-paid:", JSON.stringify(m2.notice), "refund:", m2.refundTrigger);
  check(m2.refundTrigger === true && /use refund/i.test(m2.notice ?? ""),
    "manager on the PART-paid check: instruction + button", `${m2.notice} / ${m2.refundTrigger}`);
  notes.managerPartial = m2;
}

// ── 7. CLOSED: the cashier serves every line on the fully-paid check ──────────
log("\n=== 7. the same check, marked served → CLOSED ===");
await openInOrderManagement(cash, fired.orderNo);
const servedBtn = cash.getByRole("button", { name: /^Mark .* served$/ });
const n = await servedBtn.count();
log("  'Mark … served' buttons:", n);
for (let i = 0; i < n; i++) {
  await cash.getByRole("button", { name: /^Mark .* served$/ }).first().click();
  await cash.waitForTimeout(3500);
}
await cash.waitForTimeout(2500);
const rowClosed = await orderRow(cash, fired.orderNo, ctok);
log("  server row now:", JSON.stringify(rowClosed?.settlementStatus ?? "gone from the live list"));
await openInOrderManagement(cash, fired.orderNo);
await shot(cash, "90l-cashier-closed");
const c3 = await drawerProbe(cash);
log("  cashier, closed:", JSON.stringify(c3.notice), "refund:", c3.refundTrigger);
const statusText = await cash.evaluate(() =>
  (document.querySelector("[data-testid=order-table-detail-drawer]")?.innerText || "")
    .replace(/\s+/g, " ").slice(0, 300));
log("  drawer text:", statusText);
check(c3.notice !== null && /manager/i.test(c3.notice ?? "") && !/use refund/i.test(c3.notice ?? ""),
  "settled check: the cashier is still told a manager refunds it", c3.notice);
notes.cashierClosed = { probe: c3, settlementStatus: rowClosed?.settlementStatus ?? null, drawerText: statusText };

// ── 8. cross-tenant ───────────────────────────────────────────────────────────
log("\n=== 8. cross-tenant: Control Bistro cashier reaching for this order ===");
const ctrl = await newPage(browser);
await login(ctrl, CTRL_CASHIER);
const xtok = await tokenOf(ctrl);
const cross = await apiGet(ctrl, `/api/v1/pos/orders/${fired.orderId}`, xtok);
log("  GET the Floating Terrace order as Control Bistro:", cross.status, JSON.stringify(cross.body).slice(0, 180));
check(cross.status === 404 || cross.status === 403,
  "the other tenant cannot read this order", String(cross.status));
const crossPay = await apiGet(ctrl, `/api/v1/pos/orders/${fired.orderId}/payments`, xtok);
log("  and its payments:", crossPay.status, JSON.stringify(crossPay.body).slice(0, 180));
check(crossPay.status !== 200 || (crossPay.body?.data ?? []).length === 0,
  "no payment rows leak across the tenant boundary", `${crossPay.status}`);
notes.crossTenant = { order: cross.status, payments: crossPay.status };

log("\n=========== F13 RE-OPEN SUMMARY ===========");
log("  order:", fired.orderNo, " part-paid order:", p2?.orderNo);
log(fails.length === 0 ? "  NOTHING RE-OPENED — all checks pass" : `  ${fails.length} FAILED:\n   - ${fails.join("\n   - ")}`);
writeFileSync(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F13/_reopen.json",
  JSON.stringify({ fails, notes }, null, 2),
);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);

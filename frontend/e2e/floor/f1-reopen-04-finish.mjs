/*
 * F1 RE-OPEN — part 2: the reload question, the refund, the submit, the manager's review.
 *
 * Part 1 left two things open:
 *   - after a hard reload the till bar showed NEITHER the close button NOR the panel. That is the
 *     finding's "did it PERSIST?" question and it has to be answered by reading what the bar
 *     actually said, not by a missing selector.
 *   - the manager's own read of the cashier's till reconciliation returned no order lines, so the
 *     refund could not be aimed. Whether that is a permission boundary or a bug is worth knowing.
 */
import { PEOPLE, newBrowser, newPage, go, apiGet, apiSend, tokenOf, log, money } from "../shift/lib.mjs";
import { loginTenant as login } from "./f1-reopen-lib.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "../.planning/audits/floor/F1-reopen";
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot: ${n}.png`); };

const st = JSON.parse(readFileSync(resolve(process.cwd(), "../.planning/audits/shift/_state.json"), "utf8"));
const CASHIER = { ...st.newCashier, password: st.newCashier.newPassword };
const M = JSON.parse(readFileSync(`${OUT}/money.json`, "utf8"));
const R = { tillId: M.tillId };

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, CASHIER);
const tok = await tokenOf(cash);

const reconOf = async (page, t) => {
  const r = await apiGet(page, `/api/v1/pos/tills/${M.tillId}/reconciliation`, t);
  return { status: r.status, body: r.body?.data ?? r.body };
};
const readPanel = (page) => page.evaluate(() => {
  const panel = document.querySelector("[data-testid=close-till-panel]");
  const exp = document.querySelector("[data-testid=close-till-expected]");
  const v = document.querySelector("[data-testid=close-till-variance]");
  const confirm = document.querySelector("[data-testid=close-till-confirm-button]");
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const tone = (c) => { probe.className = c; return getComputedStyle(probe).color; };
  const tones = { destructive: tone("text-destructive"), success: tone("text-success"), warning: tone("text-warning") };
  probe.remove();
  return {
    panelText: panel ? panel.innerText.replace(/\s+/g, " ").trim() : null,
    expectedText: exp ? exp.innerText.replace(/\s+/g, " ").trim() : null,
    varianceText: v ? v.innerText.replace(/\s+/g, " ").trim() : null,
    varianceIs: v ? Object.entries(tones).find(([, c]) => c === getComputedStyle(v).color)?.[0] ?? "OTHER" : null,
    confirmDisabled: confirm ? confirm.disabled : null,
  };
});
const typeCount = async (page, s) => {
  const i = page.locator("[data-testid=close-till-panel] input[type=number]").first();
  await i.fill(""); await page.waitForTimeout(250);
  if (s !== "") await i.fill(s);
  await page.waitForTimeout(1200);
};

// ── A. the reload question, answered by reading the bar ───────────────────────
log("\n=== A. what does the till bar say after a hard reload? ===");
await go(cash, "/app/pos", { waitMs: 9000 });
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
await typeCount(cash, "4285.30");
const preReload = await readPanel(cash);
log("  before reload — expected:", preReload.expectedText, "| variance:", preReload.varianceText);
await cash.reload({ waitUntil: "domcontentloaded" });
for (const ms of [3000, 6000, 10000, 16000]) {
  await cash.waitForTimeout(ms === 3000 ? 3000 : ms - (ms === 6000 ? 3000 : ms === 10000 ? 6000 : 10000));
  const bar = await cash.evaluate(() => {
    const el = document.querySelector("[data-testid=close-till-button]")?.closest("div")
      ?? document.querySelector("[data-testid=till-status-unavailable]")
      ?? document.querySelector("[data-testid=open-till-button]")?.closest("div");
    return {
      barText: el ? el.innerText.replace(/\s+/g, " ").trim() : null,
      hasClose: !!document.querySelector("[data-testid=close-till-button]"),
      hasOpen: !!document.querySelector("[data-testid=open-till-button]"),
      unavailable: !!document.querySelector("[data-testid=till-status-unavailable]"),
      panelOpen: !!document.querySelector("[data-testid=close-till-panel]"),
      pageHead: document.body.innerText.replace(/\s+/g, " ").slice(0, 220),
    };
  });
  log(`  @${ms}ms:`, JSON.stringify(bar));
  R[`reload_${ms}`] = bar;
}
await shot(cash, "q01-after-reload");
const canReopen = await cash.evaluate(() => !!document.querySelector("[data-testid=close-till-button]"));
if (canReopen) {
  await cash.locator("[data-testid=close-till-button]").click();
  await cash.waitForTimeout(2500);
  const p = await readPanel(cash);
  log("  re-opened panel after reload — expected:", p.expectedText, "| count box cleared:", p.confirmDisabled);
  R.afterReloadPanel = p;
  await shot(cash, "q02-panel-after-reload");
}

// ── B. who may read this drawer's reconciliation ──────────────────────────────
log("\n=== B. the reconciliation read, by persona ===");
const mine = await reconOf(cash, tok);
log("  cashier (own drawer):", mine.status, "orders:", mine.body?.orders?.length,
    "liveExpected:", money(mine.body?.liveExpectedCashPaisa ?? 0));
R.reconCashier = { status: mine.status, orders: mine.body?.orders?.length ?? null };

const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);
const asMgr = await reconOf(mgr, mtok);
log("  manager (another's drawer):", asMgr.status, "orders:", asMgr.body?.orders?.length ?? JSON.stringify(asMgr.body).slice(0, 200));
R.reconManager = { status: asMgr.status, orders: asMgr.body?.orders?.length ?? null, body: asMgr.status >= 400 ? asMgr.body : null };

const kit = await newPage(browser);
let kitchenStatus = null;
try {
  await login(kit, PEOPLE.kitchen);
  const ktok = await tokenOf(kit);
  const asKit = await reconOf(kit, ktok);
  kitchenStatus = asKit.status;
  log("  kitchen (wrong persona entirely):", asKit.status, JSON.stringify(asKit.body).slice(0, 200));
} catch (e) { log("  kitchen login failed:", e.message.slice(0, 120)); }
R.reconKitchen = kitchenStatus;

// ── C. a Rs 50.00 cash refund lands mid-count ─────────────────────────────────
log("\n=== C. refund Rs 50.00 cash on the cashier's own CASH check ===");
const lines = mine.body?.orders ?? [];
log("  order lines on this till:", JSON.stringify(lines.map((l) => ({ no: l.orderNo, st: l.status, paid: l.paidPaisa }))));
const target = lines.find((l) => l.orderNo === M.orderA.no) ?? lines[0];
log("  aiming at:", target?.orderNo, target?.orderId);
const expBeforeRefund = mine.body.liveExpectedCashPaisa;
const rf = await apiSend(mgr, "POST", `/api/v1/pos/orders/${target.orderId}/refund`,
  { refundPaisa: 5000, reason: "F1 re-open — Rs 50 back out of the drawer mid-shift", scope: "PARTIAL" }, mtok);
log("  refund:", rf.status, JSON.stringify(rf.body?.data ? { status: rf.body.data.status } : rf.body).slice(0, 300));
R.refund = { status: rf.status, err: rf.status >= 400 ? rf.body : null };

const after = await reconOf(cash, tok);
log("  server liveExpected: was", money(expBeforeRefund), "→ now", money(after.body.liveExpectedCashPaisa),
    " delta", money(after.body.liveExpectedCashPaisa - expBeforeRefund));
R.expectedBeforeRefund = expBeforeRefund;
R.expectedAfterRefund = after.body.liveExpectedCashPaisa;

await go(cash, "/app/pos", { waitMs: 12000 });
const strip2 = await cash.evaluate(() => {
  const l = document.querySelector("[data-testid=till-live-cash]");
  return l ? l.innerText.replace(/^Cash:\s*/, "").replace(/\s+/g, " ").trim() : null;
});
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(3000);
const pRef = await readPanel(cash);
log("  strip after refund:", strip2, "| panel expected:", pRef.expectedText);
log("  panel:", pRef.panelText);
R.afterRefund = { strip: strip2, expectedText: pRef.expectedText, panelText: pRef.panelText };
await shot(cash, "q03-after-refund");

// ── D. count Rs 200 short of the NEW figure, submit, read it back ─────────────
log("\n=== D. count Rs 200 short, submit ===");
const exp2 = after.body.liveExpectedCashPaisa;
await typeCount(cash, ((exp2 - 20000) / 100).toFixed(2));
const pFin = await readPanel(cash);
log("  preview:", pFin.varianceText, "|", pFin.varianceIs);
R.finalPreview = { text: pFin.varianceText, tone: pFin.varianceIs, expectedText: pFin.expectedText };
await shot(cash, "q04-final-preview");

for (const [w, h, n] of [[390, 844, "390"], [768, 1024, "768"]]) {
  await cash.setViewportSize({ width: w, height: h });
  await cash.waitForTimeout(800);
  const o = await cash.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    expected: document.querySelector("[data-testid=close-till-expected]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    variance: document.querySelector("[data-testid=close-till-variance]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  }));
  log(`  @${w}px overflow=${o.overflow} expected="${o.expected}" variance="${o.variance}"`);
  R[`vp${n}`] = o;
  await shot(cash, `q05-panel-${n}`);
}
await cash.setViewportSize({ width: 1440, height: 950 });
await cash.emulateMedia({ colorScheme: "dark" });
await cash.waitForTimeout(900);
const pDark = await readPanel(cash);
log("  dark:", pDark.varianceText, "|", pDark.varianceIs);
R.dark = { text: pDark.varianceText, tone: pDark.varianceIs };
await shot(cash, "q06-dark");
await cash.emulateMedia({ colorScheme: "light" });
await cash.waitForTimeout(600);

await cash.locator("[data-testid=close-till-note]").fill("F1 re-open — Rs 200 short on purpose, after a Rs 50 cash refund");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(12000);
R.closeError = await cash.evaluate(
  () => document.querySelector("[data-testid=close-till-error]")?.innerText?.trim() ?? null);
log("  close error:", R.closeError);
await shot(cash, "q07-after-close");

const closed = await apiGet(cash, `/api/v1/pos/tills/${M.tillId}`, tok);
const cb = closed.body?.data ?? closed.body;
R.persisted = { status: cb.status, expectedPaisa: cb.expectedClosingPaisa,
                declaredPaisa: cb.declaredClosingPaisa, variancePaisa: cb.variancePaisa };
R.shownExpectedPaisa = exp2;
R.agree = exp2 === cb.expectedClosingPaisa;
log("  persisted:", JSON.stringify(R.persisted));
log("  SHOWN", exp2, money(exp2), "vs PERSISTED", cb.expectedClosingPaisa, money(cb.expectedClosingPaisa ?? 0),
    "→ AGREE:", R.agree);

await go(cash, "/app/pos", { waitMs: 10000 });
R.barAfterClose = await cash.evaluate(() => ({
  noActiveTill: /No active till/.test(document.body.innerText),
  hasOpen: !!document.querySelector("[data-testid=open-till-button]"),
}));
log("  cashier bar after close + reload:", JSON.stringify(R.barAfterClose));
await shot(cash, "q08-bar-after-close");

// ── E. the manager's Till Review ──────────────────────────────────────────────
log("\n=== E. the manager's Till Review ===");
const t = await go(mgr, "/app/pos/tills", { waitMs: 9000 });
log("  trouble:", JSON.stringify(t.bad), "alerts:", JSON.stringify(t.alerts));
R.managerRow = await mgr.evaluate((tid) => {
  const rows = Array.from(document.querySelectorAll("tr"));
  const hit = rows.find((r) => r.innerHTML.includes(tid) || r.innerText.includes(tid.slice(0, 8)));
  return {
    headers: Array.from(document.querySelectorAll("th")).map((h) => h.innerText.trim()),
    row: hit ? hit.innerText.replace(/\s+/g, " ").trim() : null,
    firstRow: rows[1] ? rows[1].innerText.replace(/\s+/g, " ").trim() : null,
    rowCount: rows.length,
  };
}, M.tillId);
log("  headers:", JSON.stringify(R.managerRow.headers));
log("  my row :", R.managerRow.row);
log("  row[1] :", R.managerRow.firstRow);
await shot(mgr, "q09-manager-till-review");

writeFileSync(`${OUT}/finish.json`, JSON.stringify(R, null, 1));
console.log("\n──────── RESULT ────────\n" + JSON.stringify(R, null, 1));
await browser.close();

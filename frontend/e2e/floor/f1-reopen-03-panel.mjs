/*
 * F1 RE-OPEN — the close panel itself, driven as the cashier, with a REFUND landing mid-count.
 *
 * DONE MEANS (from the finding): with an open till that has taken at least one cash payment, press
 * Close Till; BEFORE typing anything the panel shows Opening float AND Expected cash, and Expected
 * equals the green strip above it to the paisa; type a count Rs 200 short and the variance renders
 * "Rs 200.00 short" in the destructive colour before submitting; submit; then the manager's Till
 * Review shows the same EXPECTED / DECLARED / VARIANCE.
 *
 * Beyond that, three things the fixing agent's run did not do:
 *   - a MANAGER issues a Rs 50.00 cash refund WHILE the drawer is open, then the cashier re-reads
 *     the panel: closeTill subtracts cash refunds, so if the live figure did not, the cashier would
 *     be shown a number Rs 50 higher than the one they are about to sign for;
 *   - the panel is re-read after a full RELOAD (the finding's "did it PERSIST?");
 *   - every tone is measured against a probe element's computed colour, never a class list.
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
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));

const reconOf = async () => {
  const r = await apiGet(cash, `/api/v1/pos/tills/${M.tillId}/reconciliation`, tok);
  return r.body?.data ?? r.body;
};

/** Read the panel exactly as the cashier sees it, resolving tones from a live probe element. */
const readPanel = (page) => page.evaluate(() => {
  const panel = document.querySelector("[data-testid=close-till-panel]");
  const exp = document.querySelector("[data-testid=close-till-expected]");
  const v = document.querySelector("[data-testid=close-till-variance]");
  const confirm = document.querySelector("[data-testid=close-till-confirm-button]");
  const err = document.querySelector("[data-testid=close-till-declared-error]");
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const tone = (c) => { probe.className = c; return getComputedStyle(probe).color; };
  const tones = {
    destructive: tone("text-destructive"),
    success: tone("text-success"),
    warning: tone("text-warning"),
  };
  probe.remove();
  return {
    panelText: panel ? panel.innerText.replace(/\s+/g, " ").trim() : null,
    hasExpectedLabel: panel ? /Expected cash/.test(panel.innerText) : false,
    expectedText: exp ? exp.innerText.replace(/\s+/g, " ").trim() : null,
    varianceText: v ? v.innerText.replace(/\s+/g, " ").trim() : null,
    varianceColor: v ? getComputedStyle(v).color : null,
    varianceIs: v
      ? Object.entries(tones).find(([, c]) => c === getComputedStyle(v).color)?.[0] ?? "OTHER"
      : null,
    tones,
    confirmDisabled: confirm ? confirm.disabled : null,
    declaredError: err ? err.innerText.trim() : null,
  };
});

const typeCount = async (page, s) => {
  const input = page.locator("[data-testid=close-till-panel] input[type=number]").first();
  await input.fill("");
  await page.waitForTimeout(300);
  if (s !== "") await input.fill(s);
  await page.waitForTimeout(1200);
};

// ── 1. the strip, then the panel, before a character is typed ─────────────────
log("\n=== 1. Close Till, read Expected BEFORE typing ===");
await go(cash, "/app/pos", { waitMs: 9000 });
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  const live = document.querySelector("[data-testid=till-live-cash]");
  return {
    text: b ? b.closest("div").innerText.replace(/\s+/g, " ").trim() : null,
    liveCash: live ? live.innerText.replace(/^Cash:\s*/, "").replace(/\s+/g, " ").trim() : null,
  };
});
log("  green strip:", strip.text);
R.strip = strip;
await shot(cash, "p10-strip");

const rec1 = await reconOf();
log("  server: liveExpectedCashPaisa =", rec1.liveExpectedCashPaisa, `(${money(rec1.liveExpectedCashPaisa)})`,
    " session.expectedClosingPaisa =", rec1.session.expectedClosingPaisa);
R.serverLive1 = rec1.liveExpectedCashPaisa;
R.sessionExpectedWhileOpen = rec1.session.expectedClosingPaisa;

await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
const p0 = await readPanel(cash);
log("  panel BEFORE typing:", JSON.stringify({
  hasExpectedLabel: p0.hasExpectedLabel, expectedText: p0.expectedText,
  varianceText: p0.varianceText, confirmDisabled: p0.confirmDisabled,
}));
log("  full panel text:", p0.panelText);
R.beforeTyping = p0;
await shot(cash, "p11-panel-before-typing");

// ── 2. short / over / balanced / negative / empty ─────────────────────────────
log("\n=== 2. the variance preview, tone measured by computed colour ===");
const exp1 = rec1.liveExpectedCashPaisa;
await typeCount(cash, ((exp1 - 20000) / 100).toFixed(2));
const pShort = await readPanel(cash);
log("  SHORT  :", pShort.varianceText, "|", pShort.varianceIs, pShort.varianceColor);
R.short = pShort;
await shot(cash, "p12-short");

await typeCount(cash, ((exp1 + 13500) / 100).toFixed(2));
const pOver = await readPanel(cash);
log("  OVER   :", pOver.varianceText, "|", pOver.varianceIs, pOver.varianceColor);
R.over = pOver;
await shot(cash, "p13-over");

await typeCount(cash, (exp1 / 100).toFixed(2));
const pBal = await readPanel(cash);
log("  EXACT  :", pBal.varianceText, "|", pBal.varianceIs, pBal.varianceColor);
R.balanced = pBal;
await shot(cash, "p14-balanced");

await typeCount(cash, "-40");
const pNeg = await readPanel(cash);
log("  NEG    :", JSON.stringify({ err: pNeg.declaredError, variance: pNeg.varianceText, disabled: pNeg.confirmDisabled }));
R.negative = pNeg;
await shot(cash, "p15-negative");

await typeCount(cash, "");
const pEmpty = await readPanel(cash);
log("  EMPTY  :", JSON.stringify({ variance: pEmpty.varianceText, disabled: pEmpty.confirmDisabled, expected: pEmpty.expectedText }));
R.empty = pEmpty;

// ── 3. a reload with the panel open ───────────────────────────────────────────
log("\n=== 3. reload, re-open the panel — does the figure persist? ===");
await cash.reload({ waitUntil: "domcontentloaded" });
await cash.waitForTimeout(9000);
const afterReloadBar = await cash.evaluate(() => ({
  panelStillOpen: !!document.querySelector("[data-testid=close-till-panel]"),
  hasCloseButton: !!document.querySelector("[data-testid=close-till-button]"),
}));
log("  after reload:", JSON.stringify(afterReloadBar));
if (!afterReloadBar.panelStillOpen && afterReloadBar.hasCloseButton) {
  await cash.locator("[data-testid=close-till-button]").click();
  await cash.waitForTimeout(2500);
}
const pReload = await readPanel(cash);
log("  expected after reload:", pReload.expectedText);
R.afterReload = { expectedText: pReload.expectedText, panelStillOpen: afterReloadBar.panelStillOpen };
await shot(cash, "p16-after-reload");

// ── 4. a manager refunds Rs 50.00 cash WHILE the drawer is open ───────────────
log("\n=== 4. a manager refunds Rs 50.00 cash mid-count ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);
const orders = await apiGet(mgr, `/api/v1/pos/tills/${M.tillId}/reconciliation`, mtok);
const ob = orders.body?.data ?? orders.body;
const cashOrder = (ob.orders ?? []).find((o) => o.orderNo === M.orderA.no);
log("  refunding on", cashOrder?.orderNo, cashOrder?.orderId);
const rf = await apiSend(mgr, "POST", `/api/v1/pos/orders/${cashOrder.orderId}/refund`,
  { refundPaisa: 5000, reason: "F1 re-open — cash back out of the drawer mid-shift", scope: "PARTIAL" }, mtok);
log("  refund:", rf.status, JSON.stringify(rf.body?.data ? { status: rf.body.data.status } : rf.body).slice(0, 300));
R.refund = { status: rf.status, body: rf.status >= 400 ? rf.body : null };

const rec2 = await reconOf();
log("  server after refund: liveExpected =", money(rec2.liveExpectedCashPaisa),
    " (was", money(exp1) + ", delta", money(rec2.liveExpectedCashPaisa - exp1) + ")");
R.serverLive2 = rec2.liveExpectedCashPaisa;

// the cashier's screen must follow, without them doing anything clever
await go(cash, "/app/pos", { waitMs: 12000 });
const strip2 = await cash.evaluate(() => {
  const live = document.querySelector("[data-testid=till-live-cash]");
  return live ? live.innerText.replace(/^Cash:\s*/, "").replace(/\s+/g, " ").trim() : null;
});
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(3000);
const pAfterRefund = await readPanel(cash);
log("  strip after refund:", strip2);
log("  panel after refund:", pAfterRefund.expectedText);
log("  full panel text:", pAfterRefund.panelText);
R.afterRefund = { strip: strip2, expectedText: pAfterRefund.expectedText, panelText: pAfterRefund.panelText };
await shot(cash, "p17-after-refund");

// ── 5. count Rs 200 short of the NEW expected and submit ──────────────────────
log("\n=== 5. count Rs 200 short of the post-refund expected, then submit ===");
const exp2 = rec2.liveExpectedCashPaisa;
const declared = exp2 - 20000;
await typeCount(cash, (declared / 100).toFixed(2));
const pFinal = await readPanel(cash);
log("  variance shown:", pFinal.varianceText, "|", pFinal.varianceIs);
R.finalPreview = { text: pFinal.varianceText, tone: pFinal.varianceIs, expectedText: pFinal.expectedText };
await shot(cash, "p18-final-preview");

// responsive + dark on the same panel
for (const [w, h, n] of [[390, 844, "390"], [768, 1024, "768"]]) {
  await cash.setViewportSize({ width: w, height: h });
  await cash.waitForTimeout(800);
  const o = await cash.evaluate(() => ({
    bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    expected: document.querySelector("[data-testid=close-till-expected]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  }));
  log(`  @${w}: horizontal overflow=${o.bodyOverflow} expected="${o.expected}"`);
  R[`viewport${n}`] = o;
  await shot(cash, `p19-panel-${n}`);
}
await cash.setViewportSize({ width: 1440, height: 950 });
await cash.emulateMedia({ colorScheme: "dark" });
await cash.waitForTimeout(900);
const pDark = await readPanel(cash);
log("  dark:", pDark.varianceText, "|", pDark.varianceIs, pDark.varianceColor);
R.dark = { text: pDark.varianceText, tone: pDark.varianceIs, color: pDark.varianceColor, tones: pDark.tones };
await shot(cash, "p20-dark");
await cash.emulateMedia({ colorScheme: "light" });
await cash.waitForTimeout(600);

await cash.locator("[data-testid=close-till-note]").fill("F1 re-open — Rs 200 short on purpose, after a Rs 50 cash refund");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(11000);
const closeErr = await cash.evaluate(
  () => document.querySelector("[data-testid=close-till-error]")?.innerText?.trim() ?? null);
log("  close error:", closeErr);
R.closeError = closeErr;
await shot(cash, "p21-after-close");

const closed = await apiGet(cash, `/api/v1/pos/tills/${M.tillId}`, tok);
const cb = closed.body?.data ?? closed.body;
R.persisted = {
  status: cb.status,
  expectedPaisa: cb.expectedClosingPaisa,
  declaredPaisa: cb.declaredClosingPaisa,
  variancePaisa: cb.variancePaisa,
};
log("  persisted:", JSON.stringify(R.persisted));
log("  cashier was SHOWN expected =", exp2, `(${money(exp2)})`,
    " | server persisted expected =", cb.expectedClosingPaisa, `(${money(cb.expectedClosingPaisa)})`,
    " | AGREE:", exp2 === cb.expectedClosingPaisa);
R.shownExpectedPaisa = exp2;
R.agreeShownVsPersisted = exp2 === cb.expectedClosingPaisa;

// reload — does the CLOSED state persist on the cashier's screen?
await go(cash, "/app/pos", { waitMs: 9000 });
const barAfter = await cash.evaluate(() => ({
  noActiveTill: /No active till/.test(document.body.innerText),
  hasOpenButton: !!document.querySelector("[data-testid=open-till-button]"),
}));
log("  cashier bar after close + reload:", JSON.stringify(barAfter));
R.barAfterClose = barAfter;
await shot(cash, "p22-bar-after-close");

// ── 6. the manager's Till Review ──────────────────────────────────────────────
log("\n=== 6. the manager's Till Review ===");
const t = await go(mgr, "/app/pos/tills", { waitMs: 8000 });
log("  trouble:", JSON.stringify(t.bad), "alerts:", JSON.stringify(t.alerts));
const row = await mgr.evaluate((tid) => {
  const rows = Array.from(document.querySelectorAll("tr"));
  const hit = rows.find((r) => r.innerHTML.includes(tid) || r.innerText.includes(tid.slice(0, 8)));
  return {
    headers: Array.from(document.querySelectorAll("th")).map((h) => h.innerText.trim()),
    row: hit ? hit.innerText.replace(/\s+/g, " ").trim() : null,
    firstRow: rows[1] ? rows[1].innerText.replace(/\s+/g, " ").trim() : null,
  };
}, M.tillId);
log("  headers:", JSON.stringify(row.headers));
log("  my row :", row.row);
log("  row[1] :", row.firstRow);
R.managerRow = row;
await shot(mgr, "p23-manager-till-review");

writeFileSync(`${OUT}/panel.json`, JSON.stringify(R, null, 1));
console.log("\n──────── RESULT ────────\n" + JSON.stringify(R, null, 1));
await browser.close();

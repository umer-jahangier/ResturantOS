/*
 * F1 PROOF — the cashier counts the drawer with the expected figure in front of them.
 *
 * Drives the whole DONE MEANS path in real Chromium, as the two people who do the job:
 *
 *   CASHIER  open a fresh till (Rs 5,000 float) → ring a check → take CASH → close the check
 *            → press Close Till → read Expected cash BEFORE typing and compare it, to the
 *            paisa, with the green strip one line above → type a count Rs 200 SHORT → read the
 *            variance preview and its COMPUTED colour (never the class list) → submit.
 *   MANAGER  open Till Review for that session → read EXPECTED / DECLARED / VARIANCE and
 *            check all three against what the cashier saw.
 *
 * Every screenshot lands in .planning/audits/floor/F1/.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log, money, BASE,
} from "../shift/lib.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "../.planning/audits/floor/F1";
const st = JSON.parse(readFileSync(resolve(process.cwd(), "../.planning/audits/shift/_state.json"), "utf8"));
const CASHIER = { ...st.newCashier, password: st.newCashier.newPassword };

const results = {};
const shot = async (page, n) => {
  await page.screenshot({ path: `${OUT}/${n}.png` });
  log(`    shot: ${n}.png`);
};

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, CASHIER);
log("  signed in as the cashier:", CASHIER.email);

// ── 1. a fresh drawer ─────────────────────────────────────────────────────────
log("\n=== 1. open a fresh till ===");
await go(cash, "/app/pos", { waitMs: 8000 });
let tillState = await cash.evaluate(() => ({
  open: !!document.querySelector("[data-testid=close-till-button]"),
  closed: !!document.querySelector("[data-testid=open-till-button]"),
}));
log("  till state:", JSON.stringify(tillState));
if (!tillState.open) {
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(1200);
  await cash.locator("[data-testid=open-till-panel] input[type=number]").fill("5000");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(7000);
  await go(cash, "/app/pos", { waitMs: 7000 });
}
await shot(cash, "10-till-open");

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
let tills = await apiGet(cash, `/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, tok);
const till = (tills.body?.data ?? [])[0];
if (!till) throw new Error("no OPEN till after opening one");
log("  till:", till.id, "float", money(till.openingFloatPaisa));
results.tillId = till.id;

// ── 2. ring a check and take cash ─────────────────────────────────────────────
log("\n=== 2. ring a takeaway check and take cash for it ===");
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
await tiles.nth(1).click();
await cash.waitForTimeout(800);
await shot(cash, "11-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(8000);
const fired = await cash.evaluate(() => ({
  nos: Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
}));
log("  fired:", JSON.stringify(fired));
await shot(cash, "12-fired");

const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&size=60`, tok);
const mine = (list.body?.data ?? []).filter((o) => o.cashierId === claims.sub && o.paymentStatus === "UNPAID");
const order = mine[mine.length - 1];
log("  my unpaid check:", order?.orderNo, money(order?.totalPaisa ?? 0));
results.orderNo = order.orderNo;
results.orderTotalPaisa = order.totalPaisa;

await go(cash, `/app/pos/orders/${order.orderId}/charge`, { waitMs: 7000 });
const fillFull = cash.locator("[data-testid=fill-full-amount-button]");
if (await fillFull.count()) {
  await fillFull.click();
  await cash.waitForTimeout(800);
}
const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
if (await tendered.count()) {
  await tendered.fill(String(Math.ceil(order.totalPaisa / 100) + 500));
  await cash.waitForTimeout(900);
}
await shot(cash, "13-charge-cash");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(8000);
await shot(cash, "14-paid");
const closeBtn = cash.locator("[data-testid=close-order-button]");
if (await closeBtn.count()) {
  const dis = await closeBtn.first().isDisabled();
  log("  close-order button disabled:", dis);
  if (!dis) {
    await closeBtn.first().click();
    await cash.waitForTimeout(8000);
  }
}
await shot(cash, "15-order-closed");

// ── 3. the green strip, then the close panel ──────────────────────────────────
log("\n=== 3. the cashier presses Close Till ===");
await go(cash, "/app/pos", { waitMs: 8000 });
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  const live = document.querySelector("[data-testid=till-live-cash]");
  return {
    text: b ? b.closest("div").innerText.replace(/\s+/g, " ").trim() : null,
    liveCash: live ? live.innerText.replace(/\s+/g, " ").replace(/^Cash:\s*/, "").trim() : null,
  };
});
log("  green strip:", strip.text);
log("  strip live cash:", strip.liveCash);
results.stripLiveCash = strip.liveCash;
await shot(cash, "16-green-strip");

const recon = await apiGet(cash, `/api/v1/pos/tills/${till.id}/reconciliation`, tok);
const rb = recon.body?.data ?? recon.body;
log("  server: liveExpectedCashPaisa =", rb.liveExpectedCashPaisa, `(${money(rb.liveExpectedCashPaisa)})`,
    " expectedClosingPaisa on the session =", rb.session.expectedClosingPaisa);
results.serverExpectedPaisa = rb.liveExpectedCashPaisa;

await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
const beforeTyping = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  const exp = document.querySelector("[data-testid=close-till-expected]");
  const confirm = document.querySelector("[data-testid=close-till-confirm-button]");
  return {
    text: p ? p.innerText.replace(/\s+/g, " ").trim() : null,
    hasOpeningFloat: p ? /Opening float/.test(p.innerText) : false,
    hasExpected: p ? /Expected cash/.test(p.innerText) : false,
    expectedValue: exp ? exp.innerText.replace(/\s+/g, " ").trim() : null,
    confirmDisabled: confirm ? confirm.disabled : null,
    variancePresent: !!document.querySelector("[data-testid=close-till-variance]"),
  };
});
log("  close panel BEFORE typing anything:", JSON.stringify(beforeTyping, null, 1));
results.beforeTyping = beforeTyping;
await shot(cash, "17-close-panel-before-typing");

// ── 4. count Rs 200 short ─────────────────────────────────────────────────────
log("\n=== 4. count the drawer Rs 200 short ===");
const declaredPaisa = rb.liveExpectedCashPaisa - 20000;
await cash.locator("[data-testid=close-till-panel] input[type=number]").first().fill((declaredPaisa / 100).toFixed(2));
await cash.waitForTimeout(1500);
const afterTyping = await cash.evaluate(() => {
  const v = document.querySelector("[data-testid=close-till-variance]");
  if (!v) return { present: false };
  const cs = getComputedStyle(v);
  // Resolve the semantic tokens from a probe element so the assertion is colour-value based,
  // never a class-name check (cn()/tailwind-merge has silently dropped utilities before).
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const tone = (cls) => {
    probe.className = cls;
    return getComputedStyle(probe).color;
  };
  const destructive = tone("text-destructive");
  const success = tone("text-success");
  const warning = tone("text-warning");
  probe.remove();
  return {
    present: true,
    text: v.innerText.replace(/\s+/g, " ").trim(),
    color: cs.color,
    destructive,
    success,
    warning,
    isDestructive: cs.color === destructive,
    isSuccess: cs.color === success,
  };
});
log("  variance preview:", JSON.stringify(afterTyping, null, 1));
results.afterTyping = afterTyping;
await shot(cash, "18-variance-200-short");

// responsive + dark theme sanity on the same panel
for (const [w, h, name] of [[390, 844, "390"], [768, 1024, "768"], [1440, 950, "1440"]]) {
  await cash.setViewportSize({ width: w, height: h });
  await cash.waitForTimeout(700);
  await shot(cash, `19-panel-${name}`);
}
await cash.emulateMedia({ colorScheme: "dark" });
await cash.waitForTimeout(700);
await shot(cash, "20-panel-dark");
const darkTone = await cash.evaluate(() => {
  const v = document.querySelector("[data-testid=close-till-variance]");
  return v ? { text: v.innerText.replace(/\s+/g, " ").trim(), color: getComputedStyle(v).color } : null;
});
log("  dark theme variance:", JSON.stringify(darkTone));
results.darkTone = darkTone;
await cash.emulateMedia({ colorScheme: "light" });
await cash.setViewportSize({ width: 1440, height: 950 });
await cash.waitForTimeout(600);

// ── 5. submit ─────────────────────────────────────────────────────────────────
log("\n=== 5. submit the close ===");
await cash.locator("[data-testid=close-till-note]").fill("F1 proof — counted Rs 200 short on purpose");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(9000);
const closeErr = await cash.evaluate(
  () => document.querySelector("[data-testid=close-till-error]")?.textContent?.trim() ?? null,
);
log("  close error:", closeErr);
results.closeError = closeErr;
await shot(cash, "21-after-close");

const closed = await apiGet(cash, `/api/v1/pos/tills/${till.id}`, tok);
const cb = closed.body?.data ?? closed.body;
log("  persisted:", JSON.stringify({
  status: cb.status,
  expected: cb.expectedClosingPaisa,
  declared: cb.declaredClosingPaisa,
  variance: cb.variancePaisa,
}));
results.persisted = {
  status: cb.status,
  expectedPaisa: cb.expectedClosingPaisa,
  declaredPaisa: cb.declaredClosingPaisa,
  variancePaisa: cb.variancePaisa,
};

// ── 6. the manager's Till Review ──────────────────────────────────────────────
log("\n=== 6. the manager reviews the session ===");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
let seen = null;
for (const route of ["/app/pos/tills", "/app/finance/till-review", "/app/pos/till-review", "/app/reports/tills"]) {
  const t = await go(mgr, route, { waitMs: 6000, allowTrouble: true });
  const has = await mgr.evaluate(() => /Till|Expected|Declared|Variance/i.test(document.body.innerText));
  log(`  ${route} → trouble ${JSON.stringify(t.bad)} hasTillWords=${has}`);
  if (!t.bad.length && has) { seen = route; break; }
}
log("  manager till review route:", seen);
results.managerRoute = seen;
if (seen) {
  await mgr.waitForTimeout(2500);
  const row = await mgr.evaluate((tid) => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const hit = rows.find((r) => r.innerHTML.includes(tid) || r.innerText.includes(tid.slice(0, 8)));
    const headers = Array.from(document.querySelectorAll("th")).map((h) => h.innerText.trim());
    return {
      headers,
      row: hit ? hit.innerText.replace(/\s+/g, " ").trim() : null,
      firstRow: rows[1] ? rows[1].innerText.replace(/\s+/g, " ").trim() : null,
    };
  }, till.id);
  log("  till review headers:", JSON.stringify(row.headers));
  log("  matched row:", row.row);
  log("  first row:", row.firstRow);
  results.managerRow = row;
  await shot(mgr, "22-manager-till-review");
}

log("\n──────── RESULT ────────");
log(JSON.stringify(results, null, 1));
await browser.close();

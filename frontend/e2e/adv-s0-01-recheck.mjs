// Adversarial re-verification of S0-01 — independent drive, my own probes.
// node e2e/adv-s0-01-recheck.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-01/adversarial");
mkdirSync(OUT, { recursive: true });

const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const R = { steps: [], failures: [] };
const log = (...a) => console.log(...a);
function must(cond, msg) {
  if (!cond) { R.failures.push(msg); log("    FAIL:", msg); }
  else log("    ok:", msg);
}

let BEARER = null;
function watchSession(page) {
  page.on("request", (req) => {
    const a = req.headers()["authorization"];
    if (a && a.startsWith("Bearer ")) BEARER = a;
  });
}

async function shot(page, n) { await page.screenshot({ path: `${OUT}/${n}.png` }); }

async function login(page, who) {
  BEARER = null;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 20 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    await page.screenshot({ path: `${OUT}/login-failed-${who.email}.png` });
    const h = await pageHealth(page);
    throw new Error(`login failed for ${who.email} — ${JSON.stringify(h)}`);
  }
  await page.waitForTimeout(2500);
}

async function pageHealth(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim()).filter(Boolean),
    bad: /Couldn.t load|SERVICE_UNAVAILABLE|Access denied|Order not found/i.test(document.body.innerText),
  }));
}

async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b, bearer, gw]) => {
    const h = { Authorization: bearer, "Idempotency-Key": crypto.randomUUID() };
    if (b) h["Content-Type"] = "application/json";
    const r = await fetch(gw + p, { method: m, credentials: "include", headers: h, body: b ? JSON.stringify(b) : undefined });
    let j = null; const t = await r.text();
    try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  }, [method, path, body ?? null, BEARER, GW]);
}

function branchOf() {
  const p = JSON.parse(Buffer.from(BEARER.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  return p.branch_id;
}
/** GET one order — the endpoint REQUIRES branchId; without it you get a 400 that looks like an empty order. */
async function getOrder(page, id) {
  const r = await api(page, "GET", `/api/v1/pos/orders/${id}?branchId=${branchOf()}`);
  if (r.status !== 200) throw new Error(`getOrder ${id} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.data ?? r.body;
}

/** A cash payment needs an open till. Sibling agents close it; open one if it is not. */
async function ensureTill(page) {
  const btn = page.locator('[data-testid="open-till-button"]');
  if (await btn.count()) {
    log("    no active till — opening one");
    await btn.first().click();
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="open-till-panel"] input[type="number"]').first().fill("5000.00");
    await page.waitForTimeout(400);
    await page.locator('[data-testid="open-till-confirm-button"]').click();
    await page.waitForTimeout(5000);
    const err = page.locator('[data-testid="open-till-error"]');
    if (await err.count()) throw new Error(`open till failed: ${await err.first().textContent()}`);
  }
}

async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await ensureTill(page);
  // The POS page remembers its tab; make sure we are on the Terminal before hunting for tiles.
  const term = page.getByRole("button", { name: "Terminal", exact: true });
  if (await term.count()) { await term.first().click().catch(() => {}); await page.waitForTimeout(2500); }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  try {
    await tiles.first().waitFor({ timeout: 40000 });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/no-menu-grid.png` });
    const h = await pageHealth(page);
    throw new Error(`no menu tiles. health=${JSON.stringify(h)} text=${(await page.evaluate(() => document.body.innerText)).slice(0, 600)}`);
  }
  await tiles.nth(0).click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(4500);
  const orderNo = await page.evaluate(() => (document.body.innerText.match(/ORD-\d{8}-\d+/) || [null])[0]);
  if (!orderNo) throw new Error("no order number after Send to Kitchen");
  return orderNo;
}

async function openFromOM(page, orderNo) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(2500);
  const h = await pageHealth(page);
  if (h.bad || h.alerts.length) {
    log("    retrying OM — error state:", JSON.stringify(h));
    await page.locator('[data-testid="order-management-refresh"]').click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  const search = page.locator('[data-testid="order-management-search"]');
  if (await search.count()) { await search.first().fill(orderNo); await page.waitForTimeout(2500); }
  const row = page.locator(`tr:has-text("${orderNo}")`).first();
  await row.waitFor({ timeout: 25000 });
  const openBtn = row.locator('[data-testid^="open-order-"]');
  const orderId = (await openBtn.getAttribute("data-testid")).replace("open-order-", "");
  await openBtn.click();
  await page.waitForTimeout(2500);
  return orderId;
}

async function probe(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const v = q('[aria-label="Void order"]'), rf = q('[aria-label="Refund order"]');
    const n = q('[data-testid="void-blocked-paid-notice"]');
    return {
      voidPresent: !!v, voidEnabled: v ? !v.disabled : false,
      refundPresent: !!rf, refundEnabled: rf ? !rf.disabled : false,
      notice: n ? n.textContent.trim() : null,
    };
  });
}

async function charge(page, orderId, rupeesOrNull) {
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  const h = await pageHealth(page);
  if (h.bad) { log("    charge page error, retrying:", JSON.stringify(h)); await page.reload(); await page.waitForTimeout(4000); }
  const f = page.locator('input[aria-label="Amount (Rs)"]').first();
  await f.waitFor({ timeout: 20000 });
  if (rupeesOrNull != null) { await f.fill(String(rupeesOrNull)); }
  else {
    const pre = await f.inputValue();
    if (!pre || Number(pre) <= 0) {
      const o = await getOrder(page, orderId);
      const paisa = o.totalPaisa;
      if (!Number.isFinite(paisa) || paisa <= 0) throw new Error(`bad total for ${orderId}: ${paisa}`);
      await f.fill(`${Math.floor(paisa / 100)}.${String(paisa % 100).padStart(2, "0")}`);
    }
  await page.waitForTimeout(600);
  }
  // Capture what the server actually said — a 429/503 here records NO payment and would make
  // "void succeeded" look like a pass when the order was simply never paid.
  let postStatus = null;
  const onResp = async (r) => {
    if (r.request().method() === "POST" && /\/pos\/orders\/.*\/payments/.test(r.url())) postStatus = r.status();
  };
  page.on("response", onResp);
  await page.locator('[data-testid="record-payment-button"], button:has-text("Record Payment")').first().click();
  await page.waitForTimeout(6000);
  page.off("response", onResp);
  log("    POST payments ->", postStatus);
  if (postStatus !== 200 && postStatus !== 201) {
    throw new Error(`payment did NOT record (POST /payments -> ${postStatus}); the stack is unhealthy, not the feature`);
  }
}

const payList = (b) => (Array.isArray(b?.data) ? b.data : Array.isArray(b) ? b : []);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", (e) => log("    ! pageerror:", String(e).slice(0, 140)));
  watchSession(page);

  await login(page, MANAGER);
  log("signed in as manager");

  // ═══ A: FULL cash → Void must be gone, Refund must work, must PERSIST ═══
  log("\n[A] full cash payment");
  const noA = await ringAndFire(page);
  const idA = await openFromOM(page, noA);
  log("    A order", noA, idA);
  await charge(page, idA, null);
  const payA = await api(page, "GET", `/api/v1/pos/orders/${idA}/payments`);
  R.A_paymentsAfterCharge = payA.body;
  must(payList(payA.body).length === 1, `A: exactly one tender after charge (${JSON.stringify(payList(payA.body))})`);
  const ordA = await getOrder(page, idA);
  R.A_statusAfterCharge = ordA.status;
  log("    A status after full cash:", R.A_statusAfterCharge);

  await openFromOM(page, noA);
  const pA = await probe(page);
  R.A_probe = pA;
  await shot(page, "A1-paid-order-controls");
  log("   ", JSON.stringify(pA));
  must(pA.voidPresent === false, "A: Void trigger absent on paid order");
  must(!!pA.notice, `A: a stated reason is on screen: "${pA.notice}"`);
  must(pA.refundPresent && pA.refundEnabled, "A: Refund trigger present and enabled");

  // direct void attempt with manager's live JWT
  const dvA = await api(page, "POST", `/api/v1/pos/orders/${idA}/void`, { reason: "adversarial direct void" });
  R.A_directVoid = dvA;
  must(dvA.status >= 400 && dvA.status < 500, `A: direct POST /void returns 4xx (got ${dvA.status} ${JSON.stringify(dvA.body).slice(0, 200)})`);
  const ordA2 = await getOrder(page, idA);
  must(ordA2.status !== "VOIDED", `A: order NOT voided after direct attempt (status ${ordA2.status})`);

  // refund from the UI
  log("\n[A] refund from the UI");
  await openFromOM(page, noA);
  await page.locator('[aria-label="Refund order"]').first().click();
  await page.waitForTimeout(900);
  await shot(page, "A2-refund-panel");
  await page.locator('textarea[placeholder*="Wrong item served"]').first().fill("adversarial recheck — guest left, cash returned");
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Confirm Refund")').first().click();
  await page.waitForTimeout(5000);
  await shot(page, "A3-after-refund");

  const payA2 = await api(page, "GET", `/api/v1/pos/orders/${idA}/payments`);
  R.A_paymentsAfterRefund = payA2.body;
  const rowsA = payList(payA2.body);
  const netA = rowsA.reduce((s, r) => s + r.amountPaisa, 0);
  must(rowsA.length >= 2, `A: payments now has tender + reversal (${JSON.stringify(rowsA)})`);
  must(netA === 0, `A: net held = 0 paisa (got ${netA})`);
  const ordA3 = await getOrder(page, idA);
  R.A_statusAfterRefund = ordA3.status;
  must(R.A_statusAfterRefund === "REFUNDED", `A: status REFUNDED (got ${R.A_statusAfterRefund})`);

  // PERSISTENCE: hard reload, reopen from Order Management
  log("\n[A] persistence — hard reload + reopen");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await openFromOM(page, noA);
  const persist = await page.evaluate(() => document.body.innerText);
  R.A_persistMentionsRefunded = /Refunded|REFUNDED/.test(persist);
  await shot(page, "A4-after-reload");
  must(R.A_persistMentionsRefunded, "A: order still reads Refunded after a full reload");
  const pA2 = await probe(page);
  R.A_probeAfterRefund = pA2;
  must(pA2.voidPresent === false, "A: Void still absent on the REFUNDED order");

  // double refund attempt (money must not be creatable)
  const dr = await api(page, "POST", `/api/v1/pos/orders/${idA}/refund`, { refundPaisa: 100, reason: "adversarial double refund", scope: "PARTIAL" });
  R.A_doubleRefund = dr;
  must(dr.status >= 400, `A: second refund on a fully-refunded order refused (got ${dr.status} ${JSON.stringify(dr.body).slice(0, 160)})`);
  const payA3 = await api(page, "GET", `/api/v1/pos/orders/${idA}/payments`);
  const netA3 = payList(payA3.body).reduce((s, r) => s + r.amountPaisa, 0);
  must(netA3 === 0, `A: net still 0 after double-refund attempt (got ${netA3})`);

  // ═══ B: PARTIAL payment → void must also be refused ═══
  log("\n[B] PARTIAL payment");
  const noB = await ringAndFire(page);
  const idB = await openFromOM(page, noB);
  const ordB0 = await getOrder(page, idB);
  const totalB = ordB0.totalPaisa;
  log("    B order", noB, idB, "total paisa", totalB);
  await charge(page, idB, "100.00"); // Rs 100 partial of Rs 499
  const payB = await api(page, "GET", `/api/v1/pos/orders/${idB}/payments`);
  R.B_payments = payB.body;
  const netB = payList(payB.body).reduce((s, r) => s + r.amountPaisa, 0);
  log("    B net paid paisa:", netB);
  must(netB > 0 && netB < totalB, `B: partially paid (${netB} of ${totalB})`);

  await openFromOM(page, noB);
  const pB = await probe(page);
  R.B_probe = pB;
  await shot(page, "B1-partial-paid-controls");
  log("   ", JSON.stringify(pB));
  must(pB.voidPresent === false, "B: Void trigger absent on a PARTIALLY paid order");
  const dvB = await api(page, "POST", `/api/v1/pos/orders/${idB}/void`, { reason: "adversarial partial void" });
  R.B_directVoid = dvB;
  must(dvB.status >= 400 && dvB.status < 500, `B: direct void on partially paid order 4xx (got ${dvB.status})`);

  // ═══ C: UNPAID order → void must STILL work (no regression) ═══
  log("\n[C] unpaid order — void must still work");
  const noC = await ringAndFire(page);
  const idC = await openFromOM(page, noC);
  const pC = await probe(page);
  R.C_probe = pC;
  await shot(page, "C1-unpaid-controls");
  must(pC.voidPresent === true, "C: Void trigger IS present on an unpaid order");
  await page.locator('[aria-label="Void order"]').first().click();
  await page.waitForTimeout(800);
  const ta = page.locator('textarea').first();
  await ta.fill("adversarial recheck — unpaid, guest walked");
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(4500);
  await shot(page, "C2-after-void");
  const ordC = await getOrder(page, idC);
  R.C_status = ordC.status;
  must(R.C_status === "VOIDED", `C: unpaid order still voidable through the UI (got ${R.C_status})`);

  // ═══ D: pay AFTER... can a payment be recorded on a VOIDED order? ═══
  const pv = await api(page, "POST", `/api/v1/pos/orders/${idC}/payments`, { method: "CASH", amountPaisa: 10000 });
  R.D_payOnVoided = pv;
  must(pv.status >= 400, `D: cannot record a payment on a VOIDED order (got ${pv.status})`);

  writeFileSync(`${OUT}/manager-results.json`, JSON.stringify(R, null, 2));

  // ═══ E: WRONG PERSONA — cashier ═══
  log("\n[E] cashier persona");
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(60000);
  page2.setDefaultNavigationTimeout(120000);
  watchSession(page2);
  await login(page2, CASHIER);
  log("    signed in as cashier");
  // cashier rings + pays their own order, then tries to void it
  const noE = await ringAndFire(page2);
  const idE = await openFromOM(page2, noE);
  await charge(page2, idE, null);
  const payE = await api(page2, "GET", `/api/v1/pos/orders/${idE}/payments`);
  R.E_payments = payE.body;
  const netE = payList(payE.body).reduce((s, r) => s + r.amountPaisa, 0);
  must(netE > 0, `E: cashier's order is paid (${netE} paisa)`);
  await openFromOM(page2, noE);
  const pE = await probe(page2);
  R.E_probe = pE;
  await shot(page2, "E1-cashier-paid-controls");
  log("   ", JSON.stringify(pE));
  must(pE.voidPresent === false, "E: cashier sees NO Void on their own paid order");
  const dvE = await api(page2, "POST", `/api/v1/pos/orders/${idE}/void`, { reason: "adversarial cashier void" });
  R.E_directVoid = dvE;
  must(dvE.status >= 400 && dvE.status < 500, `E: cashier direct void on paid order 4xx (got ${dvE.status} ${JSON.stringify(dvE.body).slice(0, 200)})`);
  // and: does the cashier now get a Refund button? (permission widening check)
  R.E_refundPresentForCashier = pE.refundPresent;
  const rfE = await api(page2, "POST", `/api/v1/pos/orders/${idE}/refund`, { refundPaisa: netE, reason: "adversarial cashier refund", scope: "FULL" });
  R.E_directRefund = rfE;
  log("    E cashier direct refund ->", rfE.status, JSON.stringify(rfE.body).slice(0, 200));

  writeFileSync(`${OUT}/results.json`, JSON.stringify(R, null, 2));
  log("\n═══ failures:", R.failures.length);
  R.failures.forEach((f) => log("  ✗", f));
  await browser.close();
  if (R.failures.length) process.exit(1);
}

main().catch(async (e) => { console.error("FATAL", e); writeFileSync(`${OUT}/results.json`, JSON.stringify(R, null, 2)); process.exit(2); });
